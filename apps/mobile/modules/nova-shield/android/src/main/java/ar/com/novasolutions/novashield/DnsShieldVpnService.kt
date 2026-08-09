package ar.com.novasolutions.novashield

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Escudo DNS para Android.
 *
 * Es un VpnService, pero NO es una VPN: al túnel se le rutean únicamente las
 * IPs de los servidores DNS, así que lo único que entra por la interfaz son
 * las consultas de nombres. El resto del tráfico —lo que navegás, lo que
 * mandás— viaja por fuera, sin pasar por acá y sin que la app pueda verlo.
 * Es la diferencia entre filtrar nombres y espiar tráfico.
 *
 * Los servidores DNS del usuario se respetan: a cada uno se le asigna un alias
 * dentro del túnel y las consultas permitidas se reenvían al servidor real que
 * corresponde. Forzar un resolver propio rompería redes corporativas, portales
 * cautivos y nombres locales.
 *
 * Implementado desde cero a partir de los RFC y la documentación de Android:
 * las referencias más conocidas (DNS66, DNSNet, NetGuard) son GPL-3.0 y no se
 * puede derivar código de ellas en un producto propietario.
 */
class DnsShieldVpnService : VpnService() {

  companion object {
    const val ACTION_START = "ar.com.novasolutions.novashield.START"
    const val ACTION_STOP = "ar.com.novasolutions.novashield.STOP"

    private const val TAG = "NovaShieldDNS"
    private const val CHANNEL_ID = "nova_shield_escudo"
    private const val NOTIFICATION_ID = 1001

    /** Canal aparte para los avisos de bloqueo: estos SÍ tienen que verse. */
    private const val BLOCK_CHANNEL_ID = "nova_shield_bloqueos"

    /**
     * Límites del aviso de bloqueo. Una sola carga de página dispara decenas de
     * consultas al mismo dominio: sin esto el teléfono vibraría en loop y la
     * persona apagaría el escudo, que es exactamente lo que queremos evitar.
     */
    private const val NOTIFY_MIN_GAP_MS = 30_000L
    private const val NOTIFY_PER_DOMAIN_GAP_MS = 600_000L

    /**
     * Prefijos de documentación (RFC 5737): direcciones que por definición no
     * existen en ninguna red real, así que no pueden chocar con la del usuario.
     */
    private val TUN_PREFIXES = arrayOf("192.0.2", "198.51.100", "203.0.113")

    /** Si el sistema no expone sus DNS, se usa este resolver, que además filtra. */
    private const val FALLBACK_DNS = "9.9.9.9"

    private const val UPSTREAM_TIMEOUT_MS = 4000
    private const val FORWARD_THREADS = 8

    @Volatile
    var isRunning: Boolean = false
      private set
  }

  private var tunnel: ParcelFileDescriptor? = null
  private val running = AtomicBoolean(false)
  private var worker: Thread? = null
  private var forwarders: ExecutorService? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  /** DNS reales del sistema, en el orden en que se les asignó alias. */
  @Volatile
  private var upstreamServers: List<InetAddress> = emptyList()
  private val writeLock = Any()

  // Contadores de diagnóstico. Sobreviven a rebuildTunnel() a propósito: el
  // usuario no distingue "cambió de WiFi" de "se rompió", y reiniciarlos en
  // cada cambio de red haría ilegible el diagnóstico.
  private var packetsSeen = 0
  private var queriesParsed = 0
  private var blockedInSession = 0

  /** Throttling del aviso de bloqueo, en memoria del servicio. */
  private var lastNotifyAt = 0L
  private val notifiedDomains = HashMap<String, Long>()

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopShield()
        return START_NOT_STICKY
      }
      // intent == null es el reinicio de START_STICKY tras la muerte del
      // proceso: startShield() tiene que poder rearmarse solo (lista incluida).
      else -> startShield()
    }
    // START_STICKY: si el sistema mata el proceso por memoria, el escudo vuelve.
    return START_STICKY
  }

  @Synchronized
  private fun startShield() {
    if (running.get()) return

    // Android 14 valida el foregroundServiceType contra la categoría de la app
    // y rechaza el arranque con una excepción. Si eso pasa hay que decirlo, no
    // morir con un stack trace que solo se ve con el teléfono conectado a una
    // computadora.
    try {
      startForeground(NOTIFICATION_ID, buildNotification())
    } catch (err: Exception) {
      Log.e(TAG, "El sistema rechazó el servicio en primer plano", err)
      fail("El sistema no dejó arrancar el servicio del escudo (${err.javaClass.simpleName}).")
      return
    }

    // El proceso pudo haber muerto y revivido con el object Blocklist en cero
    // (el reinicio sticky no pasa por JS ni por NovaShieldModule.start). Sin
    // lista NO se levanta el túnel: un escudo que reporta "activo" y deja pasar
    // todo es peor que un escudo caído y visible.
    if (!Blocklist.ensureLoaded(this)) {
      Log.e(TAG, "Sin lista de bloqueo utilizable: el escudo no arranca")
      fail("La lista de bloqueo no se pudo cargar. Probá sincronizarla de nuevo.")
      return
    }

    upstreamServers = systemDnsServers()
    val builder = Builder().setSession("Nova Shield")

    var prefix: String? = null
    for (candidate in TUN_PREFIXES) {
      try {
        builder.addAddress("$candidate.1", 24)
        prefix = candidate
        break
      } catch (_: IllegalArgumentException) {
        continue // esa dirección ya está en uso: probamos la siguiente
      }
    }
    if (prefix == null) {
      Log.e(TAG, "No se pudo asignar una dirección al túnel")
      fail("No pudimos armar la interfaz del escudo en esta red.")
      return
    }

    // Un alias por cada DNS real. Solo se rutea ese /32: nada más entra al túnel.
    upstreamServers.forEachIndexed { index, _ ->
      val alias = "$prefix.${index + 2}"
      builder.addDnsServer(alias)
      builder.addRoute(alias, 32)
    }

    val descriptor = try {
      builder
        // La propia app queda afuera: sus llamadas al backend no pasan por acá.
        .addDisallowedApplication(packageName)
        .setBlocking(true)
        .setMtu(1500)
        .establish()
    } catch (err: Exception) {
      Log.e(TAG, "No se pudo establecer el túnel", err)
      null
    }

    if (descriptor == null) {
      Log.e(TAG, "establish() devolvió null: falta consentimiento o hay otra VPN activa")
      ShieldBus.publishError(
        this,
        "Otra VPN está activa o falta el permiso. Desactivá la otra VPN e intentá de nuevo.",
      )
      ShieldBus.publishStatus("preempted")
      stopForegroundCompat()
      stopSelf()
      return
    }

    tunnel = descriptor
    running.set(true)
    isRunning = true
    ShieldBus.clearError(this)
    ShieldBus.publishStatus("active")
    publishDiagnostics()

    forwarders = Executors.newFixedThreadPool(FORWARD_THREADS)
    worker = thread(name = "nova-shield-dns", isDaemon = true) { pumpPackets(descriptor) }
    watchNetworkChanges()
  }

  /**
   * Se rinde dejando el motivo escrito donde la app lo puede leer.
   *
   * `start()` en el módulo devuelve apenas le pide al sistema que levante el
   * servicio, así que nada de lo que falle acá adentro puede volver por esa
   * promesa. Sin dejar el motivo, activar el escudo y que no arranque se ve
   * igual que activarlo y que funcione.
   */
  private fun fail(reason: String) {
    ShieldBus.publishError(this, reason)
    ShieldBus.publishStatus("inactive")
    stopForegroundCompat()
    stopSelf()
  }

  /** Foto de los contadores para que la app la muestre. Solo números. */
  private fun publishDiagnostics() {
    ShieldBus.publishDiagnostics(
      this,
      packetsSeen,
      queriesParsed,
      blockedInSession,
      Blocklist.domainCount,
    )
  }

  /** DNS configurados en la red activa. Si no hay ninguno, se usa el fallback. */
  private fun systemDnsServers(): List<InetAddress> {
    val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    val servers = manager?.activeNetwork
      ?.let { manager.getLinkProperties(it) }
      ?.dnsServers
      // Solo IPv4: los alias del túnel se asignan sobre un prefijo IPv4.
      ?.filterIsInstance<Inet4Address>()
      ?: emptyList()

    return servers.ifEmpty { listOf(InetAddress.getByName(FALLBACK_DNS)) }
  }

  /**
   * Los DNS del sistema cambian con la red (WiFi → 4G, otro WiFi) y los
   * capturamos al armar el túnel: sin esto, tras un cambio de red las consultas
   * se reenviarían a los resolvers de la red anterior —inalcanzables o, peor,
   * los de un WiFi ajeno— hasta timeout. Como los alias del túnel quedan fijos
   * en establish(), la reacción es rearmar el túnel con la lista nueva.
   */
  private fun watchNetworkChanges() {
    if (networkCallback != null) return
    val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return

    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onLinkPropertiesChanged(network: Network, props: LinkProperties) {
        val fresh = props.dnsServers.filterIsInstance<Inet4Address>()
        if (fresh.isNotEmpty() && fresh != upstreamServers) {
          Log.i(TAG, "Cambio de DNS de la red: rearmando el túnel")
          rebuildTunnel()
        }
      }
    }
    try {
      manager.registerDefaultNetworkCallback(callback)
      networkCallback = callback
    } catch (err: Exception) {
      Log.w(TAG, "No se pudo escuchar cambios de red", err)
    }
  }

  private fun unwatchNetworkChanges() {
    val callback = networkCallback ?: return
    networkCallback = null
    val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    runCatching { manager?.unregisterNetworkCallback(callback) }
  }

  /** Baja solo el plano de datos (túnel + hilos) y vuelve a armarlo. */
  @Synchronized
  private fun rebuildTunnel() {
    if (!running.getAndSet(false)) return

    forwarders?.shutdownNow()
    forwarders = null
    worker?.interrupt()
    worker = null
    runCatching { tunnel?.close() }
    tunnel = null

    startShield()
  }

  /** Bucle principal: lee consultas del túnel y las resuelve o bloquea. */
  private fun pumpPackets(descriptor: ParcelFileDescriptor) {
    val input = FileInputStream(descriptor.fileDescriptor)
    val output = FileOutputStream(descriptor.fileDescriptor)
    val buffer = ByteArray(32 * 1024)

    try {
      while (running.get()) {
        val length = try {
          input.read(buffer)
        } catch (err: Exception) {
          if (running.get()) Log.w(TAG, "Lectura del túnel interrumpida", err)
          break
        }
        if (length <= 0) continue

        packetsSeen++
        // Cada 10 paquetes, una foto del estado. Sin esto, diagnosticar el
        // escudo exige conectar el teléfono a una computadora y filtrar logcat;
        // con estos números se ve desde la app si el DNS no entra al túnel, si
        // entra y no se parsea, o si se parsea y no matchea.
        if (packetsSeen % 10 == 1) publishDiagnostics()

        // parseQuery copia lo que necesita: el buffer se reutiliza enseguida.
        val query = DnsPacket.parseQuery(buffer, length)
        if (query == null) {
          // Un SYN de TCP al alias es el fallback del resolver para respuestas
          // truncadas (TC=1). Todavía no proxyamos DNS-over-TCP: se responde
          // RST para que falle rápido en vez de colgarse hasta el timeout.
          DnsPacket.buildTcpRstForSyn(buffer, length)?.let { writePacket(output, it) }
          continue
        }

        queriesParsed++

        if (Blocklist.isBlocked(query.domain)) {
          blockedInSession++
          ShieldBus.publishBlocked(this, query.domain)
          notifyBlocked(query.domain)
          writePacket(output, DnsPacket.buildNxDomainResponse(query))
          continue
        }

        // Al pool: una consulta lenta no puede frenar al resto del teléfono.
        forwarders?.execute { forward(query, output) }
      }
    } finally {
      runCatching { input.close() }
      runCatching { output.close() }
    }
  }

  /** Reenvía la consulta al DNS real que le corresponde y devuelve la respuesta. */
  private fun forward(query: DnsPacket.Query, output: FileOutputStream) {
    val upstream = resolveUpstream(query.destIp) ?: return

    try {
      DatagramSocket().use { socket ->
        // Sin protect() el socket saldría por el propio túnel: bucle infinito.
        if (!protect(socket)) {
          Log.e(TAG, "No se pudo proteger el socket upstream")
          return
        }
        socket.soTimeout = UPSTREAM_TIMEOUT_MS
        // connect(): el kernel descarta datagramas que no vengan de upstream:53.
        // Un socket UDP sin conectar acepta paquetes de CUALQUIER origen, y eso
        // convertiría al escudo en un inyector de respuestas DNS falsas.
        socket.connect(upstream, 53)
        socket.send(DatagramPacket(query.payload, query.payload.size))

        val response = ByteArray(4096)
        val packet = DatagramPacket(response, response.size)
        val deadline = System.currentTimeMillis() + UPSTREAM_TIMEOUT_MS

        // Además del connect(), se valida que la respuesta corresponda a ESTA
        // consulta (txid + QR + misma pregunta); lo que no cuadre se descarta y
        // se sigue esperando hasta agotar el timeout.
        while (System.currentTimeMillis() < deadline) {
          packet.setLength(response.size)
          socket.receive(packet) // SocketTimeoutException al vencer soTimeout
          if (DnsPacket.isResponseTo(query, response, packet.length)) {
            writePacket(output, DnsPacket.wrapInUdpIp(query, response.copyOf(packet.length)))
            return
          }
          Log.w(TAG, "Datagrama descartado: no es respuesta a ${query.domain}")
        }
      }
    } catch (err: Exception) {
      // Timeout o red caída: no respondemos y el sistema reintenta solo.
      Log.w(TAG, "Falló la consulta upstream de ${query.domain}: ${err.message}")
    }
  }

  /** Traduce el alias del túnel al servidor DNS real: último octeto - 2. */
  private fun resolveUpstream(destIp: ByteArray): InetAddress? {
    val index = (destIp[3].toInt() and 0xFF) - 2
    return upstreamServers.getOrNull(index)
  }

  /** Una escritura = un paquete; el pool obliga a serializarlas. */
  private fun writePacket(output: FileOutputStream, packet: ByteArray) {
    synchronized(writeLock) {
      runCatching { output.write(packet) }
    }
  }

  @Synchronized
  private fun stopShield() {
    running.set(false)
    isRunning = false
    unwatchNetworkChanges()

    forwarders?.shutdownNow()
    runCatching { forwarders?.awaitTermination(1, TimeUnit.SECONDS) }
    forwarders = null

    worker?.interrupt()
    worker = null
    runCatching { tunnel?.close() }
    tunnel = null
    ShieldBus.publishStatus("inactive")

    stopForegroundCompat()
    stopSelf()
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  /** El sistema avisa así que el usuario revocó el permiso o activó otra VPN. */
  override fun onRevoke() {
    ShieldBus.publishStatus("preempted")
    stopShield()
    super.onRevoke()
  }

  override fun onDestroy() {
    running.set(false)
    isRunning = false
    unwatchNetworkChanges()
    forwarders?.shutdownNow()
    runCatching { tunnel?.close() }
    super.onDestroy()
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Escudo DNS",
        // LOW: es un aviso permanente y obligatorio, no debe sonar ni vibrar.
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Aviso permanente mientras el escudo está protegiendo el teléfono."
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }

    val openApp = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }

    // NotificationCompat y no Notification.Builder: el constructor con canal
    // recién existe en API 26 y la app soporta desde la 24.
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Nova Shield te está protegiendo")
      .setContentText("Bloqueando sitios de estafa conocidos")
      .setSmallIcon(android.R.drawable.ic_lock_lock)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .apply { openApp?.let { setContentIntent(it) } }
      .build()
  }

  /**
   * Avisa que bloqueamos un sitio.
   *
   * Sin esto, bloquear se ve EXACTAMENTE igual que quedarse sin internet: el
   * navegador dice "no se puede conectar" y la persona concluye que la app le
   * rompió la conexión. Es el peor resultado posible —el momento en que el
   * producto más sirve se lee como una falla— y termina con el escudo apagado.
   * Pasó tal cual en iOS antes de agregar el aviso.
   */
  private fun notifyBlocked(domain: String) {
    val now = System.currentTimeMillis()
    if (now - lastNotifyAt < NOTIFY_MIN_GAP_MS) return

    val lastForDomain = notifiedDomains[domain]
    if (lastForDomain != null && now - lastForDomain < NOTIFY_PER_DOMAIN_GAP_MS) return

    // Purga para que el mapa no crezca solo mientras el servicio vive.
    notifiedDomains.entries.removeAll { now - it.value >= NOTIFY_PER_DOMAIN_GAP_MS }
    notifiedDomains[domain] = now
    lastNotifyAt = now

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          BLOCK_CHANNEL_ID,
          "Sitios bloqueados",
          // HIGH: es la explicación de por qué la página no cargó. Si llega
          // callada, el usuario igual concluye que se quedó sin internet.
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          description = "Aviso cuando el escudo frena un sitio de estafa."
        },
      )
    }

    val openApp = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(
        this,
        1,
        it,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }

    val notification = NotificationCompat.Builder(this, BLOCK_CHANNEL_ID)
      .setContentTitle("Bloqueamos un sitio peligroso")
      .setContentText("No dejamos que se abra $domain.")
      .setStyle(
        NotificationCompat.BigTextStyle().bigText(
          "No dejamos que se abra $domain: figura en las bases de sitios de " +
            "estafa. Si llegaste por un mensaje, no respondas y borralo.",
        ),
      )
      .setSmallIcon(android.R.drawable.stat_sys_warning)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .apply { openApp?.let { setContentIntent(it) } }
      .build()

    manager.notify(domain.hashCode(), notification)
  }
}

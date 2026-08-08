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

    startForeground(NOTIFICATION_ID, buildNotification())

    // El proceso pudo haber muerto y revivido con el object Blocklist en cero
    // (el reinicio sticky no pasa por JS ni por NovaShieldModule.start). Sin
    // lista NO se levanta el túnel: un escudo que reporta "activo" y deja pasar
    // todo es peor que un escudo caído y visible.
    if (!Blocklist.ensureLoaded(this)) {
      Log.e(TAG, "Sin lista de bloqueo utilizable: el escudo no arranca")
      ShieldBus.publishStatus("inactive")
      stopForegroundCompat()
      stopSelf()
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
      ShieldBus.publishStatus("inactive")
      stopSelf()
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
      ShieldBus.publishStatus("preempted")
      stopSelf()
      return
    }

    tunnel = descriptor
    running.set(true)
    isRunning = true
    ShieldBus.resetCount()
    ShieldBus.publishStatus("active")

    forwarders = Executors.newFixedThreadPool(FORWARD_THREADS)
    worker = thread(name = "nova-shield-dns", isDaemon = true) { pumpPackets(descriptor) }
    watchNetworkChanges()
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

        // parseQuery copia lo que necesita: el buffer se reutiliza enseguida.
        val query = DnsPacket.parseQuery(buffer, length)
        if (query == null) {
          // Un SYN de TCP al alias es el fallback del resolver para respuestas
          // truncadas (TC=1). Todavía no proxyamos DNS-over-TCP: se responde
          // RST para que falle rápido en vez de colgarse hasta el timeout.
          DnsPacket.buildTcpRstForSyn(buffer, length)?.let { writePacket(output, it) }
          continue
        }

        if (Blocklist.isBlocked(query.domain)) {
          ShieldBus.publishBlocked(query.domain)
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

    return Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Nova Shield te está protegiendo")
      .setContentText("Bloqueando sitios de estafa conocidos")
      .setSmallIcon(android.R.drawable.ic_lock_lock)
      .setOngoing(true)
      .apply { openApp?.let { setContentIntent(it) } }
      .build()
  }
}

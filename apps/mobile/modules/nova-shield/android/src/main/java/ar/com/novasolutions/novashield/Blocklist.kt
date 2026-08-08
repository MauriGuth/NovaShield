package ar.com.novasolutions.novashield

import android.content.Context
import android.util.Log
import java.io.File
import java.security.MessageDigest

/**
 * Lista de bloqueo del Escudo DNS.
 *
 * El archivo que baja la app es un buffer binario con los SHA-256 de cada
 * dominio truncados a 8 bytes y ORDENADOS ascendentemente. Se resuelve con
 * búsqueda binaria sobre el array en memoria: sin red, sin parsear texto y sin
 * asignar objetos por consulta, que importa porque esto corre en el camino de
 * cada resolución DNS del teléfono.
 *
 * La canonicalización y el troceo por dominios padre tienen que coincidir
 * EXACTAMENTE con packages/shared/src/domain.ts; si divergen, el escudo deja
 * pasar dominios bloqueados sin ningún error visible.
 */
object Blocklist {

  const val HASH_BYTES = 8

  private const val TAG = "NovaShieldList"
  private const val PREFS = "nova_shield_blocklist"
  private const val KEY_PATH = "path"
  private const val KEY_VERSION = "version"

  @Volatile
  private var hashes: ByteArray = ByteArray(0)

  @Volatile
  var version: String = ""
    private set

  val domainCount: Int
    get() = hashes.size / HASH_BYTES

  /**
   * Carga el archivo descargado y persiste dónde quedó, para poder rehidratar
   * la lista sin JS. Devuelve cuántos dominios quedaron activos.
   *
   * La persistencia es la mitad de la corrección de un bug grave: este object
   * vive en memoria del proceso, y cuando Android mata el proceso por memoria
   * el VpnService revive solo (START_STICKY) con la lista en cero. Sin un
   * camino de recarga que no dependa de que el usuario abra la app, el escudo
   * quedaría "activo" sin bloquear nada.
   */
  @Synchronized
  fun load(context: Context, path: String, version: String): Int {
    val file = File(path.removePrefix("file://"))
    if (!file.exists()) throw IllegalArgumentException("No existe la lista en $path")

    val bytes = file.readBytes()
    require(bytes.size % HASH_BYTES == 0) {
      "Lista corrupta: ${bytes.size} bytes no es múltiplo de $HASH_BYTES"
    }

    this.hashes = bytes
    this.version = version

    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_PATH, file.absolutePath)
      .putString(KEY_VERSION, version)
      .apply()

    return bytes.size / HASH_BYTES
  }

  /**
   * Rehidrata la lista desde disco si el proceso se reinició. true si al salir
   * hay una lista utilizable. Los servicios que el sistema arranca por su
   * cuenta (VpnService sticky, NotificationListener) DEBEN llamar esto antes
   * de operar, y negarse a operar si devuelve false.
   */
  @Synchronized
  fun ensureLoaded(context: Context): Boolean {
    if (domainCount > 0) return true

    val prefs = context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val path = prefs.getString(KEY_PATH, null) ?: return false
    val savedVersion = prefs.getString(KEY_VERSION, "") ?: ""

    return try {
      load(context, path, savedVersion) > 0
    } catch (err: Exception) {
      Log.e(TAG, "No se pudo rehidratar la lista desde $path", err)
      false
    }
  }

  /**
   * ¿El host consultado —o alguno de sus dominios padre— está bloqueado?
   * Bloquear `ejemplo.com` bloquea también `login.ejemplo.com`.
   */
  fun isBlocked(host: String): Boolean {
    val canonical = canonicalDomain(host)
    if (canonical.isEmpty()) return false

    val parts = canonical.split('.')
    if (parts.size < 2) return false

    // Del más específico al más general, igual que domainLookupKeys().
    for (i in 0..parts.size - 2) {
      val candidate = parts.subList(i, parts.size).joinToString(".")
      if (contains(sha256Prefix(candidate))) return true
    }
    return false
  }

  /**
   * Minúsculas, sin punto final y sin puerto. Espejo de canonicalDomain().
   *
   * El puerto se compara contra dígitos ASCII y se exige no vacío, igual que el
   * `/^[0-9]+$/` del lado TS: `isDigit()` acepta dígitos Unicode (٤٢) y `all {}`
   * sobre una cadena vacía devuelve true, así que sin estos dos detalles
   * "host:" y "host:٤٢" se canonicalizarían distinto en cada plataforma.
   */
  private fun canonicalDomain(host: String): String {
    var h = host.trim().lowercase()
    if (h.startsWith("[")) return h
    h = h.trimEnd('.')
    val colon = h.lastIndexOf(':')
    if (colon > 0) {
      val port = h.substring(colon + 1)
      if (port.isNotEmpty() && port.all { it in '0'..'9' }) {
        h = h.substring(0, colon)
      }
    }
    return h
  }

  private fun sha256Prefix(domain: String): ByteArray =
    MessageDigest.getInstance("SHA-256")
      .digest(domain.toByteArray(Charsets.UTF_8))
      .copyOf(HASH_BYTES)

  /** Búsqueda binaria sobre el buffer ordenado. */
  private fun contains(target: ByteArray): Boolean {
    val data = hashes
    var lo = 0
    var hi = data.size / HASH_BYTES - 1

    while (lo <= hi) {
      val mid = (lo + hi) ushr 1
      val cmp = compareAt(data, mid * HASH_BYTES, target)
      when {
        cmp == 0 -> return true
        cmp < 0 -> lo = mid + 1
        else -> hi = mid - 1
      }
    }
    return false
  }

  /** Comparación sin signo, que es como ordena el servidor (Buffer.compare). */
  private fun compareAt(data: ByteArray, offset: Int, target: ByteArray): Int {
    for (i in 0 until HASH_BYTES) {
      val a = data[offset + i].toInt() and 0xFF
      val b = target[i].toInt() and 0xFF
      if (a != b) return a - b
    }
    return 0
  }
}

package ar.com.novasolutions.novashield

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Estado compartido del escudo: puente entre los Services y el módulo de Expo,
 * y memoria de lo que pasó mientras la app no estaba mirando.
 *
 * Un Service no puede llamar `sendEvent` (no es el Module), así que publica acá
 * y el módulo —que sí puede— reenvía a JS mientras esté vivo.
 *
 * Pero un listener no alcanza: si la app está cerrada no hay quien escuche, y
 * el escudo sigue bloqueando igual. Por eso todo lo que importa (contador,
 * últimos bloqueos, contadores de diagnóstico, último error) se persiste en
 * SharedPreferences y la app lo va a buscar al abrir. Es el equivalente del
 * App Group que usa la extensión de iOS, y por las mismas razones: sin esto el
 * contador queda en cero para siempre y el usuario nunca ve la prueba de que lo
 * protegimos.
 */
object ShieldBus {

  interface Listener {
    fun onDomainBlocked(domain: String, at: Long)
    fun onStatusChanged(status: String)
  }

  private const val PREFS = "nova_shield_estado"

  private const val KEY_COUNT = "blockedCount"
  private const val KEY_RECENT = "recentBlocked"
  private const val KEY_LAST_ERROR = "lastError"
  private const val KEY_LAST_ERROR_AT = "lastErrorAt"

  private const val KEY_DIAG_PACKETS = "diagPackets"
  private const val KEY_DIAG_QUERIES = "diagQueries"
  private const val KEY_DIAG_BLOCKED = "diagBlocked"
  private const val KEY_DIAG_LIST = "diagListCount"
  private const val KEY_DIAG_AT = "diagAt"

  /** Igual que en iOS: alcanza para la lista de "últimos bloqueos" de la app. */
  private const val MAX_RECENT = 50

  @Volatile
  private var listener: Listener? = null

  /**
   * Copia en memoria de los últimos bloqueos, para no volver a parsear el JSON
   * en cada uno. Esto corre en el camino de cada consulta DNS del teléfono:
   * lo que se haga acá se le suma a la latencia de abrir cualquier página.
   */
  private var recentCache: JSONArray? = null

  fun subscribe(listener: Listener) {
    this.listener = listener
  }

  fun unsubscribe(listener: Listener) {
    if (this.listener === listener) this.listener = null
  }

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Total histórico de amenazas frenadas en este teléfono. */
  fun blockedCount(context: Context): Int = prefs(context).getInt(KEY_COUNT, 0)

  /**
   * Registra un bloqueo: suma al contador, lo mete en el buzón de recientes y
   * —si hay alguien escuchando— avisa a JS en el momento.
   *
   * `@Synchronized` no es decorativo: esto lo llaman los hilos del pool de
   * reenvío del túnel y la corrutina del filtro de mensajes, y un
   * read-modify-write de SharedPreferences desde dos hilos pierde bloqueos.
   */
  @Synchronized
  fun publishBlocked(context: Context, domain: String) {
    val at = System.currentTimeMillis()
    val prefs = prefs(context)
    val count = prefs.getInt(KEY_COUNT, 0) + 1

    val previous = recentCache
      ?: runCatching { JSONArray(prefs.getString(KEY_RECENT, "[]")) }.getOrElse { JSONArray() }
    val recent = JSONArray().put(JSONObject().put("domain", domain).put("at", at))
    for (i in 0 until minOf(previous.length(), MAX_RECENT - 1)) {
      recent.put(previous.opt(i))
    }
    recentCache = recent

    prefs.edit()
      .putInt(KEY_COUNT, count)
      .putString(KEY_RECENT, recent.toString())
      .apply()

    listener?.onDomainBlocked(domain, at)
  }

  /**
   * Bloqueos guardados, para que la app reconcilie lo que pasó mientras estaba
   * cerrada. Mismo formato que devuelve el módulo de iOS.
   */
  fun blockedEvents(context: Context): Map<String, Any?> {
    val prefs = prefs(context)
    val stored = runCatching { JSONArray(prefs.getString(KEY_RECENT, "[]")) }
      .getOrElse { JSONArray() }

    val recent = ArrayList<Map<String, Any?>>(stored.length())
    for (i in 0 until stored.length()) {
      val item = stored.optJSONObject(i) ?: continue
      recent.add(
        mapOf(
          "domain" to item.optString("domain"),
          // A JS le llega como number: el store compara por (dominio, momento).
          "at" to item.optLong("at").toDouble(),
        ),
      )
    }

    return mapOf("count" to prefs.getInt(KEY_COUNT, 0), "recent" to recent)
  }

  fun publishStatus(status: String) {
    listener?.onStatusChanged(status)
  }

  /**
   * Guarda por qué el escudo NO pudo arrancar.
   *
   * `start()` le pide al sistema que levante un Service y vuelve enseguida: si
   * adentro algo falla, el error no tiene forma de llegar a la promesa que
   * espera la app. Sin este buzón, activar el escudo y que no pase nada se ve
   * exactamente igual que activarlo y que funcione — que es el peor bug que
   * tuvimos en iOS y no queremos repetir acá.
   */
  fun publishError(context: Context, reason: String) {
    prefs(context).edit()
      .putString(KEY_LAST_ERROR, reason)
      .putLong(KEY_LAST_ERROR_AT, System.currentTimeMillis())
      .apply()
  }

  fun clearError(context: Context) {
    prefs(context).edit().remove(KEY_LAST_ERROR).remove(KEY_LAST_ERROR_AT).apply()
  }

  /**
   * Foto de los contadores del túnel. SOLO números: ningún dominio se guarda
   * acá. Con estos tres se distingue si el DNS no entra al túnel, si entra y no
   * se parsea, o si se parsea y no matchea contra la lista.
   */
  fun publishDiagnostics(
    context: Context,
    packets: Int,
    queries: Int,
    blocked: Int,
    listCount: Int,
  ) {
    prefs(context).edit()
      .putInt(KEY_DIAG_PACKETS, packets)
      .putInt(KEY_DIAG_QUERIES, queries)
      .putInt(KEY_DIAG_BLOCKED, blocked)
      .putInt(KEY_DIAG_LIST, listCount)
      .putLong(KEY_DIAG_AT, System.currentTimeMillis())
      .apply()
  }

  fun diagnostics(context: Context): Map<String, Any?> {
    val prefs = prefs(context)
    val at = prefs.getLong(KEY_DIAG_AT, 0L)
    return mapOf(
      "available" to (at > 0L),
      "packets" to prefs.getInt(KEY_DIAG_PACKETS, 0),
      "queries" to prefs.getInt(KEY_DIAG_QUERIES, 0),
      "blocked" to prefs.getInt(KEY_DIAG_BLOCKED, 0),
      "listCount" to prefs.getInt(KEY_DIAG_LIST, 0),
      // Segundos desde epoch, igual que iOS (allá viene de timeIntervalSince1970).
      "at" to (at / 1000.0),
      "lastError" to prefs.getString(KEY_LAST_ERROR, null),
    )
  }
}

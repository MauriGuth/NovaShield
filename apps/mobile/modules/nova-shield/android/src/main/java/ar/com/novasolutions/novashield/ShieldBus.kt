package ar.com.novasolutions.novashield

/**
 * Puente entre los Services de Android y el módulo de Expo.
 *
 * Un Service no puede llamar `sendEvent` (no es el Module), así que publica
 * acá y el módulo —que sí puede— reenvía a JS mientras esté vivo. Si la app
 * está cerrada no hay quien escuche y los eventos se descartan: es correcto,
 * el escudo sigue bloqueando igual y el contador se reconcilia al abrir.
 */
object ShieldBus {

  interface Listener {
    fun onDomainBlocked(domain: String, at: Long)
    fun onStatusChanged(status: String)
  }

  @Volatile
  private var listener: Listener? = null

  /** Bloqueos acumulados desde que arrancó el servicio. */
  @Volatile
  var blockedCount: Int = 0
    private set

  fun subscribe(listener: Listener) {
    this.listener = listener
  }

  fun unsubscribe(listener: Listener) {
    if (this.listener === listener) this.listener = null
  }

  fun publishBlocked(domain: String) {
    blockedCount++
    listener?.onDomainBlocked(domain, System.currentTimeMillis())
  }

  fun publishStatus(status: String) {
    listener?.onStatusChanged(status)
  }

  fun resetCount() {
    blockedCount = 0
  }
}

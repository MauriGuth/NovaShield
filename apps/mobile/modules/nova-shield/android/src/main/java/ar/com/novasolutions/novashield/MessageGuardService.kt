package ar.com.novasolutions.novashield

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Protección de Mensajes para Android.
 *
 * Lee las notificaciones entrantes (SMS, WhatsApp, mail) y avisa si traen un
 * enlace que está en la lista de bloqueo. Es la única vía viable: Google Play
 * reserva los permisos de SMS para la app de mensajes por defecto, y además
 * este camino cubre WhatsApp, que es el vector número uno en Argentina.
 *
 * Todo el análisis ocurre en el dispositivo, contra la MISMA lista local que
 * usa el Escudo DNS: el contenido de tus notificaciones nunca sale del
 * teléfono. Un análisis más profundo (patrones de estafa, IA) ocurre solo si
 * el usuario abre la app y pide revisar el mensaje.
 *
 * LÍMITE CONOCIDO (Android 15+): el sistema censura el contenido de las
 * notificaciones donde detecta un código de un solo uso antes de entregarlas a
 * cualquier listener sin permiso de firma. Los SMS de estafa que traen un
 * código llegan redactados y no se pueden analizar; los que traen un link, sí.
 * No prometer cobertura de OTP en el marketing.
 */
class MessageGuardService : NotificationListenerService() {

  companion object {
    private const val TAG = "NovaShieldMsg"
    private const val CHANNEL_ID = "nova_shield_mensajes"

    /** Apps cuyas notificaciones tiene sentido revisar. */
    private val WATCHED_PACKAGES = setOf(
      "com.whatsapp",
      "com.whatsapp.w4b",
      "com.google.android.apps.messaging",
      "com.samsung.android.messaging",
      "com.android.mms",
      "com.google.android.gm",
      "com.microsoft.office.outlook",
      "org.telegram.messenger",
    )

    private val URL_REGEX =
      Regex("""\b(?:https?://)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+""", RegexOption.IGNORE_CASE)

    /** Se ignoran para no marcar "ejemplo.com" dentro de una palabra cualquiera. */
    private val IGNORED_TLDS = setOf("jpg", "png", "pdf", "doc", "mp4", "gif")
  }

  /** Los callbacks del listener son @UiThread: el análisis va a background. */
  private val analysisScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  override fun onListenerConnected() {
    super.onListenerConnected()
    // El sistema bindea este servicio por su cuenta (boot, reinstalación,
    // muerte del proceso): la lista tiene que poder rehidratarse desde disco
    // sin que el usuario haya abierto la app.
    analysisScope.launch {
      if (!Blocklist.ensureLoaded(applicationContext)) {
        Log.w(TAG, "Sin lista de bloqueo cargada: el filtro de mensajes no puede analizar")
      }
    }
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName !in WATCHED_PACKAGES) return
    if (sbn.packageName == applicationContext.packageName) return

    val notification = sbn.notification ?: return
    val text = extractText(notification)
    if (text.isEmpty()) return

    // Buscar en la lista es una búsqueda binaria sobre ~1,3 MB: fuera del hilo
    // de UI, o el sistema puede matar el servicio por bloquearlo.
    analysisScope.launch {
      // Barato cuando ya está cargada; imprescindible si el proceso revivió.
      if (!Blocklist.ensureLoaded(applicationContext)) return@launch
      val blockedDomain = findBlockedDomain(text) ?: return@launch
      Log.i(TAG, "Mensaje con dominio bloqueado: $blockedDomain")
      warnUser(blockedDomain)
      ShieldBus.publishBlocked(blockedDomain)
    }
  }

  override fun onDestroy() {
    analysisScope.cancel()
    super.onDestroy()
  }

  /**
   * Junta todo el texto disponible de la notificación.
   *
   * WhatsApp y Telegram casi nunca ponen el mensaje en EXTRA_TEXT: mandan un
   * resumen ("3 mensajes nuevos") y el contenido real va en el MessagingStyle
   * o en EXTRA_TEXT_LINES. Sin leer esos campos, el filtro tendría falsos
   * negativos masivos justo en la app donde más estafas circulan.
   */
  private fun extractText(notification: Notification): String {
    val extras = notification.extras ?: return ""
    val parts = mutableListOf<CharSequence>()

    extras.getCharSequence(Notification.EXTRA_TITLE)?.let(parts::add)
    extras.getCharSequence(Notification.EXTRA_TEXT)?.let(parts::add)
    extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.let(parts::add)
    extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.let(parts::add)

    // InboxStyle: una línea por mensaje.
    extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.forEach(parts::add)

    // MessagingStyle: el camino real de WhatsApp/Telegram.
    NotificationCompat.MessagingStyle
      .extractMessagingStyleFromNotification(notification)
      ?.messages
      ?.forEach { message -> message.text?.let(parts::add) }

    return parts.joinToString(" ").trim()
  }

  /** Primer dominio del texto que esté en la lista de bloqueo local. */
  private fun findBlockedDomain(text: String): String? {
    for (match in URL_REGEX.findAll(text)) {
      val candidate = match.value
        .substringAfter("://")
        .substringBefore('/')
        .trimEnd('.', ',', ';', ':', '!', '?')

      val tld = candidate.substringAfterLast('.', "")
      if (tld.length < 2 || tld.lowercase() in IGNORED_TLDS) continue
      if (Blocklist.isBlocked(candidate)) return candidate
    }
    return null
  }

  private fun warnUser(domain: String) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Mensajes peligrosos",
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          description = "Avisos cuando llega un mensaje con un enlace de estafa."
        },
      )
    }

    val notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Cuidado: mensaje con enlace peligroso")
      .setContentText("El enlace a $domain está reportado como estafa. No lo abras.")
      .setStyle(
        Notification.BigTextStyle().bigText(
          "Te llegó un mensaje con un enlace a $domain, que figura en las bases " +
            "de sitios de estafa. No lo abras ni cargues datos ahí. Si el mensaje " +
            "venía de un contacto conocido, avisale: puede que le hayan robado la cuenta.",
        ),
      )
      .setSmallIcon(android.R.drawable.stat_sys_warning)
      .setAutoCancel(true)
      .build()

    manager.notify(domain.hashCode(), notification)
  }
}

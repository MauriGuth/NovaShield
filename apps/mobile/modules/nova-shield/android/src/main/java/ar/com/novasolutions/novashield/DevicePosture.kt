package ar.com.novasolutions.novashield

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.provider.Settings
import androidx.biometric.BiometricManager
import java.io.File

/**
 * Señales de postura de seguridad del dispositivo (Escáner del Dispositivo).
 *
 * Todo es LECTURA de configuración pública del sistema, sin permisos
 * especiales, sin enumerar apps instaladas (nada de QUERY_ALL_PACKAGES) y sin
 * salir del dispositivo: las señales van al JS de la app, que las evalúa con
 * packages/shared/src/device.ts y muestra el resultado. Al backend no viaja
 * nada de esto — a lo sumo el score numérico, si el usuario usa Modo Familia.
 */
object DevicePosture {

  fun collect(context: Context): Map<String, Any?> {
    return mapOf(
      "platform" to "android",
      "osVersion" to (Build.VERSION.RELEASE ?: Build.VERSION.SDK_INT.toString()),
      "securityPatch" to securityPatch(),
      "screenLock" to hasScreenLock(context),
      "biometrics" to enrolledBiometrics(context),
      "rooted" to RootProbe.isLikelyRooted(),
      "accessibilityServices" to enabledAccessibilityServices(context),
      // developerOptions / usbDebugging NO se reportan: ver la nota de abajo.
    )
  }

  /*
   * POR QUÉ NO ESTÁN "opciones de desarrollador" NI "depuración USB":
   *
   * Las claves existen (Settings.Global.DEVELOPMENT_SETTINGS_ENABLED y
   * Settings.Global.ADB_ENABLED) y se leen sin permiso, pero la documentación
   * oficial de ambas dice hoy: "This will always return 0 for all third-party
   * apps". O sea que desde la app SIEMPRE se leen como apagadas, estén como
   * estén.
   *
   * Reportarlas sería peor que no tenerlas: el escáner le diría al usuario
   * "sin opciones de desarrollador" —un tilde verde y puntos de score— sobre
   * un teléfono que quizás tiene la depuración USB abierta. Un producto de
   * seguridad no puede afirmar lo que no puede verificar.
   *
   * Fuente: developer.android.com/reference/android/provider/Settings.Global
   */

  /** PIN/patrón/contraseña configurados (API 23+). */
  private fun hasScreenLock(context: Context): Boolean {
    val keyguard =
      context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager ?: return false
    return keyguard.isDeviceSecure
  }

  /**
   * ¿Hay biometría ENROLADA y utilizable? Devuelve null si no se puede saber.
   *
   * `hasSystemFeature(FEATURE_FINGERPRINT)` NO sirve para esto: informa que el
   * equipo tiene el sensor, no que el usuario haya cargado una huella. Usarlo
   * mostraría "biometría configurada" en verde en cualquier teléfono con lector,
   * incluso en uno donde nadie enroló nada.
   *
   * `BiometricManager.canAuthenticate` sí distingue los dos casos:
   * BIOMETRIC_SUCCESS = enrolada y lista; BIOMETRIC_ERROR_NONE_ENROLLED = hay
   * hardware pero está vacío. Los estados ambiguos (hardware ocupado, estado
   * desconocido) devuelven null: no sabemos, no afirmamos.
   */
  private fun enrolledBiometrics(context: Context): Boolean? {
    val manager = BiometricManager.from(context)
    val authenticators =
      BiometricManager.Authenticators.BIOMETRIC_WEAK or
        BiometricManager.Authenticators.BIOMETRIC_STRONG

    return when (manager.canAuthenticate(authenticators)) {
      BiometricManager.BIOMETRIC_SUCCESS -> true
      BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> false
      BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> false
      else -> null // hardware no disponible por ahora, estado desconocido…
    }
  }

  /** Build.VERSION.SECURITY_PATCH existe desde API 23; formato YYYY-MM-DD. */
  private fun securityPatch(): String? =
    Build.VERSION.SECURITY_PATCH?.takeIf { it.isNotBlank() }

  /**
   * Servicios de accesibilidad habilitados: es la vía de abuso número uno de
   * los troyanos bancarios de la región (leen la pantalla y tocan por el
   * usuario). Leer la LISTA es una Settings.Secure pública; no requiere que
   * esta app tenga el permiso de accesibilidad ni ver las apps instaladas.
   */
  private fun enabledAccessibilityServices(context: Context): List<String> {
    val raw = Settings.Secure.getString(
      context.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
    ) ?: return emptyList()

    return raw.split(':').map { it.trim() }.filter { it.isNotEmpty() }
  }
}

/**
 * Heurísticas de root propias (no derivadas de proyectos GPL): marcas de build
 * de test y binarios `su` en las rutas históricas. Es detección best-effort —
 * un root escondido a propósito no se va a delatar acá, y no hace falta: el
 * objetivo es avisarle al usuario común que su equipo (a veces comprado usado)
 * está rooteado sin que lo sepa.
 */
object RootProbe {

  private val SU_PATHS = arrayOf(
    "/system/bin/su",
    "/system/xbin/su",
    "/sbin/su",
    "/system/sd/xbin/su",
    "/system/bin/failsafe/su",
    "/data/local/su",
    "/data/local/bin/su",
    "/data/local/xbin/su",
    "/su/bin/su",
  )

  /**
   * NO se usa `Build.TAGS.contains("test-keys")` como señal.
   *
   * Marca como rooteados equipos de fábrica que nunca se tocaron: es habitual
   * en gama baja y en modelos de mercados como el nuestro, justo el público de
   * esta app. Un falso "tu teléfono está comprometido" en un producto de
   * seguridad es caro: o el usuario se asusta sin motivo, o aprende a ignorar
   * nuestras alertas — y la próxima, la real, también la ignora.
   *
   * Queda solo la presencia del binario `su`, que es evidencia concreta de que
   * alguien instaló acceso root.
   */
  fun isLikelyRooted(): Boolean =
    SU_PATHS.any { path ->
      try {
        File(path).exists()
      } catch (_: SecurityException) {
        false
      }
    }
}

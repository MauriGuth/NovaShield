package ar.com.novasolutions.novashield

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Serializable

/** Entrada del contrato de consentimiento (debe ser Serializable por la API de Expo). */
class VpnConsentInput(val reason: String = "escudo-dns") : Serializable

/**
 * Pide el diálogo de consentimiento de VPN del sistema. `VpnService.prepare`
 * devuelve null si el usuario ya lo aceptó antes; si no, devuelve el Intent de
 * la pantalla del sistema que hay que lanzar esperando resultado.
 */
class VpnConsentContract : AppContextActivityResultContract<VpnConsentInput, Boolean> {
  override fun createIntent(context: Context, input: VpnConsentInput): Intent =
    VpnService.prepare(context) ?: Intent()

  override fun parseResult(input: VpnConsentInput, resultCode: Int, intent: Intent?): Boolean =
    resultCode == Activity.RESULT_OK
}

/**
 * Módulo nativo del Escudo DNS y la Protección de Mensajes.
 *
 * Es el contrato que consume apps/mobile/src/lib/native-shield.ts: los nombres
 * de funciones y eventos tienen que coincidir con esa interfaz de TypeScript.
 */
class NovaShieldModule : Module(), ShieldBus.Listener {

  private lateinit var consentLauncher: AppContextActivityResultLauncher<VpnConsentInput, Boolean>

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NovaShield")

    Events("onDomainBlocked", "onStatusChange")

    RegisterActivityContracts {
      consentLauncher = registerForActivityResult(VpnConsentContract())
    }

    OnCreate { ShieldBus.subscribe(this@NovaShieldModule) }
    OnDestroy { ShieldBus.unsubscribe(this@NovaShieldModule) }

    // — Escudo DNS —

    Function("getStatus") { currentStatus() }

    AsyncFunction("requestPermission") { promise: Promise ->
      // Ya consentido: prepare() devuelve null y no hay diálogo que mostrar.
      if (VpnService.prepare(context) == null) {
        promise.resolve(true)
        return@AsyncFunction
      }
      if (!::consentLauncher.isInitialized) {
        throw CodedException(
          "ERR_LAUNCHER_NOT_READY",
          "El diálogo de VPN todavía no está disponible. Reintentá en un momento.",
          null,
        )
      }
      consentLauncher.launch(VpnConsentInput()) { granted -> promise.resolve(granted) }
      // runOnQueue(MAIN): lanzar una Activity exige el hilo principal.
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("start") {
      if (VpnService.prepare(context) != null) {
        throw CodedException(
          "ERR_VPN_NOT_PREPARED",
          "Falta el consentimiento de VPN para activar el escudo.",
          null,
        )
      }
      if (Blocklist.domainCount == 0) {
        throw CodedException(
          "ERR_BLOCKLIST_EMPTY",
          "La lista de bloqueo todavía no está cargada.",
          null,
        )
      }
      ContextCompat.startForegroundService(
        context,
        Intent(context, DnsShieldVpnService::class.java)
          .setAction(DnsShieldVpnService.ACTION_START),
      )
    }

    AsyncFunction("stop") {
      context.startService(
        Intent(context, DnsShieldVpnService::class.java)
          .setAction(DnsShieldVpnService.ACTION_STOP),
      )
    }

    Function("getBlocklistDirectory") {
      // En Android alcanza el almacenamiento privado de la app: el VpnService
      // corre en el mismo proceso y lo lee directo.
      context.filesDir.absolutePath
    }

    AsyncFunction("loadBlocklist") { path: String, version: String ->
      Blocklist.load(context, path, version)
    }

    Function("getLoadedDomainCount") { Blocklist.domainCount }

    Function("getBlockedCount") { ShieldBus.blockedCount(context) }

    /**
     * Bloqueos guardados por los servicios.
     *
     * El evento `onDomainBlocked` solo llega si la app está abierta, y el
     * escudo trabaja sobre todo cuando NO lo está. Sin este repaso, todo lo que
     * frenamos con la app cerrada se perdía y el contador arrancaba de cero.
     */
    Function("getBlockedEvents") { ShieldBus.blockedEvents(context) }

    /**
     * Contadores del túnel: paquetes vistos, consultas parseadas, bloqueos y
     * tamaño de la lista. Solo números, ningún dominio.
     */
    Function("getShieldDiagnostics") { ShieldBus.diagnostics(context) }

    /**
     * Permiso de notificaciones (Android 13+).
     *
     * Sin este permiso el sistema descarta en silencio TODOS los avisos de la
     * app: el del bloqueo y hasta el permanente del servicio. El escudo seguiría
     * bloqueando, pero cada bloqueo se vería igual que quedarse sin internet.
     */
    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        // Antes de Android 13 el permiso se otorga al instalar.
        promise.resolve(true)
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      permissions.askForPermissions(
        { result ->
          promise.resolve(
            result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED,
          )
        },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    }.runOnQueue(Queues.MAIN)

    // — Escáner del Dispositivo —

    Function("getDeviceSecuritySignals") { DevicePosture.collect(context) }

    AsyncFunction("openDeviceSettings") { section: String ->
      val action = when (section) {
        "developer" -> Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS
        "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
        "update" -> Settings.ACTION_DEVICE_INFO_SETTINGS
        else -> Settings.ACTION_SECURITY_SETTINGS
      }
      context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // — Protección de Mensajes —

    Function("isMessageProtectionEnabled") {
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners",
      )
      enabled?.contains(context.packageName) == true
    }

    AsyncFunction("openMessageProtectionSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  private fun currentStatus(): String = when {
    DnsShieldVpnService.isRunning -> "active"
    VpnService.prepare(context) != null -> "needs_permission"
    else -> "inactive"
  }

  // — ShieldBus.Listener: puente Service → JS —

  override fun onDomainBlocked(domain: String, at: Long) {
    sendEvent("onDomainBlocked", bundleOf("domain" to domain, "at" to at))
  }

  override fun onStatusChanged(status: String) {
    sendEvent("onStatusChange", bundleOf("status" to status))
  }
}

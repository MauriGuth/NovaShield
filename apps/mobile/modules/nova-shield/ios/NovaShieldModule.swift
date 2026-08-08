import ExpoModulesCore
import NetworkExtension

/**
 Módulo nativo del Escudo DNS y la Protección de Mensajes (iOS).

 Implementa el mismo contrato que el módulo Kotlin (ver
 apps/mobile/src/lib/native-shield.ts): los nombres de funciones y eventos
 tienen que coincidir en los tres lados.

 DECISIÓN DE ARQUITECTURA — por qué túnel local y no perfil DNS:
 iOS ofrece dos caminos para filtrar dominios en todo el dispositivo.
 `NEDNSSettingsManager` es más simple, pero apunta el DNS del sistema a un
 resolver DoH remoto: el filtrado pasaría a ocurrir en un servidor nuestro, que
 vería TODAS las consultas de navegación del usuario. Eso contradice la promesa
 del producto ("el análisis se hace en el propio teléfono") y crearía una
 responsabilidad enorme bajo la Ley 25.326 y la guideline 5.4 de Apple.
 `NEPacketTunnelProvider` mantiene el matching local igual que en Android, al
 costo de una extensión nativa. Se eligió el segundo.
 */
public class NovaShieldModule: Module {

  /// Debe coincidir con el App Group declarado en los entitlements de la app
  /// y de la extensión: es la única forma de compartir la lista con ella.
  private static let appGroup = "group.ar.com.novasolutions.novashield"
  private static let tunnelBundleId = "ar.com.novasolutions.novashield.DnsShield"

  private var statusObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("NovaShield")

    Events("onDomainBlocked", "onStatusChange")

    OnCreate {
      self.observeTunnelStatus()
    }

    OnDestroy {
      if let observer = self.statusObserver {
        NotificationCenter.default.removeObserver(observer)
      }
    }

    // — Escudo DNS —

    Function("getStatus") { () -> String in
      self.currentStatus()
    }

    AsyncFunction("requestPermission") { (promise: Promise) in
      // Guardar la configuración dispara el diálogo de permiso de VPN del
      // sistema; si el usuario lo rechaza, save falla con un error.
      self.loadManager { manager, error in
        if let error {
          promise.reject(ShieldError.tunnelUnavailable(error.localizedDescription))
          return
        }
        guard let manager else {
          promise.reject(ShieldError.tunnelUnavailable("sin manager"))
          return
        }
        manager.isEnabled = true
        manager.saveToPreferences { error in
          promise.resolve(error == nil)
        }
      }
    }

    AsyncFunction("start") { (promise: Promise) in
      guard ShieldBlocklist.shared.domainCount > 0 else {
        promise.reject(ShieldError.tunnelUnavailable("la lista de bloqueo no está cargada"))
        return
      }
      self.loadManager { manager, error in
        guard let manager, error == nil else {
          promise.reject(
            ShieldError.tunnelUnavailable(error?.localizedDescription ?? "sin manager"))
          return
        }
        manager.isEnabled = true
        manager.saveToPreferences { saveError in
          if let saveError {
            promise.reject(ShieldError.tunnelUnavailable(saveError.localizedDescription))
            return
          }
          // Recargar después de guardar: iOS invalida la referencia en memoria.
          manager.loadFromPreferences { _ in
            do {
              try manager.connection.startVPNTunnel()
              promise.resolve(nil)
            } catch {
              promise.reject(ShieldError.tunnelUnavailable(error.localizedDescription))
            }
          }
        }
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      self.loadManager { manager, _ in
        manager?.connection.stopVPNTunnel()
        promise.resolve(nil)
      }
    }

    Function("getBlocklistDirectory") { () -> String in
      // La lista tiene que vivir en el App Group: es el único lugar que la
      // extensión de red puede leer.
      guard
        let container = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: Self.appGroup)
      else {
        return NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
      }
      return container.path
    }

    AsyncFunction("loadBlocklist") { (path: String, version: String) -> Int in
      let url = URL(fileURLWithPath: path.replacingOccurrences(of: "file://", with: ""))
      let count = try ShieldBlocklist.shared.load(from: url, version: version)
      // La extensión corre en OTRO proceso con su propio singleton: hay que
      // publicar la versión en el App Group (es lo que lee al arrancar) y
      // avisarle si ya está corriendo, o seguiría con la lista vieja para
      // siempre.
      UserDefaults(suiteName: Self.appGroup)?.set(version, forKey: "blocklistVersion")
      self.notifyTunnelOfNewBlocklist()
      return count
    }

    Function("getLoadedDomainCount") { () -> Int in
      ShieldBlocklist.shared.domainCount
    }

    Function("getBlockedCount") { () -> Int in
      // El contador lo lleva la extensión, que corre en otro proceso: se
      // comparte por el App Group.
      guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return 0 }
      return defaults.integer(forKey: "blockedCount")
    }

    // — Escáner del Dispositivo —

    Function("getDeviceSecuritySignals") { () -> [String: Any?] in
      DevicePosture.collect()
    }

    AsyncFunction("openDeviceSettings") { (_ section: String, promise: Promise) in
      // iOS no permite deep-links a secciones puntuales de Ajustes desde apps
      // de App Store: se abre la pantalla de ajustes de la propia app.
      DispatchQueue.main.async {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
          promise.resolve(nil)
          return
        }
        UIApplication.shared.open(url) { _ in promise.resolve(nil) }
      }
    }

    // — Protección de Mensajes —

    Function("isMessageProtectionEnabled") { () -> Bool in
      // iOS no expone si el filtro de SMS está activo: el usuario lo habilita
      // en Ajustes y el sistema no lo informa. Se refleja lo último que supimos.
      guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return false }
      return defaults.bool(forKey: "messageFilterSeen")
    }

    AsyncFunction("openMessageProtectionSettings") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
          promise.resolve(nil)
          return
        }
        UIApplication.shared.open(url) { _ in promise.resolve(nil) }
      }
    }
  }

  // MARK: - Túnel

  /// Si el túnel está corriendo, le pide que recargue la lista recién escrita.
  /// Best-effort: si está apagado, va a cargar la versión nueva al arrancar.
  private func notifyTunnelOfNewBlocklist() {
    NETunnelProviderManager.loadAllFromPreferences { managers, _ in
      guard
        let session = managers?.first?.connection as? NETunnelProviderSession,
        session.status == .connected
      else { return }
      try? session.sendProviderMessage(Data("reloadBlocklist".utf8)) { _ in }
    }
  }

  private func loadManager(
    _ completion: @escaping (NETunnelProviderManager?, Error?) -> Void
  ) {
    NETunnelProviderManager.loadAllFromPreferences { managers, error in
      if let error {
        completion(nil, error)
        return
      }

      let manager = managers?.first ?? NETunnelProviderManager()
      let proto = (manager.protocolConfiguration as? NETunnelProviderProtocol)
        ?? NETunnelProviderProtocol()
      proto.providerBundleIdentifier = Self.tunnelBundleId
      // Requerido por NetworkExtension aunque el túnel sea local y no haya
      // servidor remoto al que conectarse.
      proto.serverAddress = "Nova Shield"
      manager.protocolConfiguration = proto
      manager.localizedDescription = "Nova Shield · Escudo DNS"

      completion(manager, nil)
    }
  }

  private func currentStatus() -> String {
    // El estado real lo tiene la conexión del túnel; se consulta de forma
    // sincrónica sobre la última configuración conocida.
    guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return "inactive" }
    return defaults.string(forKey: "shieldStatus") ?? "inactive"
  }

  /// El sistema publica los cambios de estado del túnel por NotificationCenter
  /// (el usuario puede apagarlo desde Ajustes sin pasar por la app).
  private func observeTunnelStatus() {
    statusObserver = NotificationCenter.default.addObserver(
      forName: .NEVPNStatusDidChange,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let self, let connection = notification.object as? NEVPNConnection else { return }

      let status: String
      switch connection.status {
      case .connected: status = "active"
      case .invalid: status = "needs_permission"
      default: status = "inactive"
      }

      UserDefaults(suiteName: Self.appGroup)?.set(status, forKey: "shieldStatus")
      self.sendEvent("onStatusChange", ["status": status])
    }
  }
}

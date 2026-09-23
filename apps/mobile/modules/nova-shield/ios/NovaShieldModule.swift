import ExpoModulesCore
import UserNotifications
import NetworkExtension
import UIKit

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

  /// Bundle id de la extensión de red.
  ///
  /// OJO: `@bacons/apple-targets` lo deriva del **`type`** del target, no del
  /// `name`. Con `type: 'network-packet-tunnel'` y `name: 'DnsShield'`, el
  /// bundle id real es `…novashield.network-packet-tunnel` — NO `.DnsShield`.
  ///
  /// Si esto no coincide exactamente, iOS no encuentra la extensión: el
  /// diálogo de permiso de VPN no aparece y el túnel nunca arranca, sin ningún
  /// error que apunte al nombre. `native-parity.spec.ts` verifica que siga
  /// coincidiendo con lo que declara expo-target.config.js.
  private static let tunnelBundleId = "ar.com.novasolutions.novashield.network-packet-tunnel"

  private var statusObserver: NSObjectProtocol?
  private var foregroundObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("NovaShield")

    Events("onDomainBlocked", "onStatusChange")

    OnCreate {
      self.observeTunnelStatus()
      self.observeForeground()
      self.refreshTunnelStatus()
    }

    OnDestroy {
      if let observer = self.statusObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      if let observer = self.foregroundObserver {
        NotificationCenter.default.removeObserver(observer)
      }
    }

    // — Escudo DNS —

    Function("getStatus") { () -> String in
      // Devuelve lo último que se supo y dispara una consulta real al sistema:
      // si cambió, llega por `onStatusChange` y la próxima lectura ya lo trae.
      self.refreshTunnelStatus()
      return self.currentStatus()
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

    /**
     Contadores que publica la extensión del túnel.

     Existen porque diagnosticar el escudo de otra forma exige conectar el
     teléfono a una Mac y filtrar logs en Consola.app — inviable para soporte, y
     un dolor incluso para nosotros. Con estos tres números se distingue si el
     DNS no entra al túnel, si entra y no se parsea, o si se parsea y no matchea.

     Son SOLO números. Ningún dominio sale de la extensión.
     */
    Function("getShieldDiagnostics") { () -> [String: Any] in
      guard let defaults = UserDefaults(suiteName: Self.appGroup) else {
        return ["available": false]
      }
      let at = defaults.double(forKey: "diagAt")
      return [
        "available": at > 0,
        "packets": defaults.integer(forKey: "diagPackets"),
        "queries": defaults.integer(forKey: "diagQueries"),
        "blocked": defaults.integer(forKey: "diagBlocked"),
        "listCount": defaults.integer(forKey: "diagListCount"),
        // Consultas de la prueba del escudo que llegaron al túnel.
        "testHits": defaults.integer(forKey: "diagTestHits"),
        "at": at,
      ]
    }

    /**
     Bloqueos que registró la extensión del túnel.

     En Android el módulo emite `onDomainBlocked` y la app lo escucha. En iOS
     eso es imposible: la extensión es otro proceso y no puede mandarle eventos
     al JS. La app tiene que venir a buscarlos acá, o el contador de bloqueos se
     queda en cero aunque el escudo esté trabajando.
     */
    Function("getBlockedEvents") { () -> [String: Any] in
      guard let defaults = UserDefaults(suiteName: Self.appGroup) else {
        return ["count": 0, "recent": []]
      }
      let recent = defaults.array(forKey: "recentBlocked") as? [[String: Any]] ?? []
      return [
        "count": defaults.integer(forKey: "blockedCount"),
        "recent": recent,
      ]
    }

    /**
     Pide permiso de notificaciones.

     Lo pide la APP, no la extensión: iOS solo acepta la solicitud desde el
     proceso principal. Sin este permiso, bloquear un sitio se ve igual que
     quedarse sin internet y el usuario culpa a la app por romperle la conexión.
     */
    AsyncFunction("requestNotificationPermission") { (promise: Promise) in
      UNUserNotificationCenter.current()
        .requestAuthorization(options: [.alert, .sound]) { granted, _ in
          promise.resolve(granted)
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
    // Última lectura conocida (la escribe refreshTunnelStatus y el observer).
    guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return "inactive" }
    return defaults.string(forKey: "shieldStatus") ?? "inactive"
  }

  private static func statusName(for status: NEVPNStatus) -> String {
    switch status {
    case .connected: return "active"
    case .invalid: return "needs_permission"
    default: return "inactive"
    }
  }

  /**
   Le pregunta al sistema el estado REAL del túnel.

   El observer de abajo solo recibe cambios mientras la app está viva. Si la
   extensión muere por memoria (jetsam) con la app cerrada, la clave del App
   Group se queda en "active" para siempre y la app, el Score y la familia lo
   repiten. Por eso se consulta al arrancar, en cada vuelta al frente y en cada
   `getStatus()`: la respuesta llega en el próximo ciclo, y si difiere de lo
   guardado se avisa por `onStatusChange`.
   */
  private func refreshTunnelStatus() {
    NETunnelProviderManager.loadAllFromPreferences { [weak self] managers, error in
      // Si la lectura falla no se sabe nada: pisar el estado con "inactive"
      // sería inventarlo.
      guard let self, error == nil else { return }
      guard let connection = managers?.first?.connection else {
        self.publishStatus("inactive")
        return
      }
      switch connection.status {
      case .connecting, .disconnecting, .reasserting:
        // Estados de paso: los resuelve el observer de NEVPNStatusDidChange.
        // Publicarlos como "inactive" pisaba el "active" del túnel: esta
        // lectura se pide en cada getStatus() —la app lo consulta cada 200 ms
        // mientras espera que el escudo confirme— y una respuesta pedida en
        // "conectando" podía llegar DESPUÉS de que el túnel quedara arriba.
        return
      default:
        self.publishStatus(Self.statusName(for: connection.status))
      }
    }
  }

  private func publishStatus(_ status: String) {
    let defaults = UserDefaults(suiteName: Self.appGroup)
    let previous = defaults?.string(forKey: "shieldStatus")
    defaults?.set(status, forKey: "shieldStatus")
    guard previous != status else { return }
    DispatchQueue.main.async { [weak self] in
      self?.sendEvent("onStatusChange", ["status": status])
    }
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
      self.publishStatus(Self.statusName(for: connection.status))
    }
  }

  /// Al volver al frente se relee el estado: es el momento en que el usuario
  /// mira la app después de que algo pudo haber tirado el túnel.
  private func observeForeground() {
    foregroundObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.refreshTunnelStatus()
    }
  }
}

import Foundation
import NetworkExtension
import os.log

/**
 Escudo DNS para iOS.

 Es un NEPacketTunnelProvider, pero NO es una VPN: al túnel se le rutea
 únicamente la IP del servidor DNS interno, así que lo único que entra por la
 interfaz son las consultas de nombres. El resto del tráfico del teléfono viaja
 por fuera y la extensión no puede verlo.

 Por cada consulta: se extrae el dominio, se busca en la lista local (sin red)
 y, si está bloqueada, se responde NXDOMAIN; si no, se reenvía al resolver real
 por una conexión que el sistema mantiene fuera del túnel.

 LÍMITE DE MEMORIA: las extensiones de red corren con un techo duro de ~50 MB
 (jetsam mata el proceso al pasarlo). Por eso la lista se mapea con
 `.mappedIfSafe` en vez de cargarse al heap, y no se guarda estado por consulta.
 */
class PacketTunnelProvider: NEPacketTunnelProvider {

  private static let appGroup = "group.ar.com.novasolutions.novashield"
  private static let blocklistFile = "blocklist.bin"

  /// Direcciones internas del túnel; no existen en ninguna red real (RFC 5737).
  ///
  /// El resolver tiene que quedar DENTRO de la subred de la interfaz. Antes la
  /// interfaz era 192.0.2.1/32 y el DNS 192.0.2.2: con una máscara /32 la
  /// interfaz no tiene subred, así que el resolver quedaba fuera de todo
  /// alcance directo y dependía solo de la ruta explícita — algo que iOS no
  /// siempre instala. Con la interfaz en /24 el resolver es directamente
  /// alcanzable y el patrón es el que usan los túneles DNS que funcionan.
  private static let tunnelAddress = "192.0.2.2"
  private static let tunnelMask = "255.255.255.0"
  private static let tunnelDns = "192.0.2.1"

  /// Resolver upstream. Quad9 filtra dominios maliciosos por su cuenta, así que
  /// suma una segunda capa además de la lista local.
  private static let upstreamDns = "9.9.9.9"

  private let log = OSLog(subsystem: "ar.com.novasolutions.novashield", category: "DnsShield")
  private var blockedCount = 0

  /**
   Contadores de diagnóstico.

   Se loguean SOLO números, nunca un dominio: el escudo promete que ninguna
   consulta sale del teléfono, y un log del sistema con los dominios visitados
   sería exactamente el registro de navegación que el producto asegura no tener.

   Con estos tres números alcanza para saber dónde se corta la cadena:
     packetsSeen == 0            → el DNS ni siquiera entra al túnel (config)
     queriesParsed == 0          → entra pero no se parsea (parser)
     blocked == 0 con parsed > 0 → se parsea pero no matchea (lista o hashing)
   */
  private var packetsSeen = 0
  private var queriesParsed = 0

  /// Una única sesión UDP reutilizable hacia el resolver. Crear una sesión por
  /// consulta filtraba ~1 KB por resolución (el read handler retenía la sesión
  /// y solo se cancelaba en el camino feliz): con el techo de ~50 MB de las
  /// extensiones de red, jetsam terminaba matando el proceso. Las respuestas se
  /// correlacionan por el transaction ID del DNS.
  private var upstreamSession: NWUDPSession?

  /// Consultas en vuelo, por transaction ID, con su momento de entrada para
  /// poder descartar las que nunca recibieron respuesta.
  private var pending: [UInt16: (query: DnsPacketParser.Query, at: Date)] = [:]
  private let pendingLock = NSLock()
  private static let pendingTimeout: TimeInterval = 4

  /// Tope de bloqueos recientes guardados para que los muestre la app.
  private static let maxRecentBlocked = 50

  override func startTunnel(
    options: [String: NSObject]?,
    completionHandler: @escaping (Error?) -> Void
  ) {
    do {
      try loadBlocklist()
    } catch {
      os_log("No se pudo cargar la lista: %{public}@", log: log, type: .error,
             error.localizedDescription)
      completionHandler(error)
      return
    }

    let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: Self.tunnelAddress)

    let ipv4 = NEIPv4Settings(addresses: [Self.tunnelAddress], subnetMasks: [Self.tunnelMask])
    // Se rutea SOLO la IP del DNS interno: nada más entra al túnel. El resto de
    // la navegación sale por la ruta normal, sin pasar por acá.
    ipv4.includedRoutes = [
      NEIPv4Route(destinationAddress: Self.tunnelDns, subnetMask: "255.255.255.255")
    ]
    ipv4.excludedRoutes = []
    settings.ipv4Settings = ipv4

    let dns = NEDNSSettings(servers: [Self.tunnelDns])
    // matchDomains vacío = se interceptan todas las consultas.
    dns.matchDomains = [""]
    settings.dnsSettings = dns
    settings.mtu = 1500

    setTunnelNetworkSettings(settings) { [weak self] error in
      if let error {
        completionHandler(error)
        return
      }
      self?.updateStatus("active")
      self?.readPackets()
      completionHandler(nil)
    }
  }

  override func stopTunnel(
    with reason: NEProviderStopReason,
    completionHandler: @escaping () -> Void
  ) {
    upstreamSession?.cancel()
    upstreamSession = nil
    updateStatus("inactive")
    completionHandler()
  }

  /**
   La app avisa por acá cuando descargó una lista nueva. Sin este mensaje la
   extensión —que corre en OTRO proceso, con su propia copia del singleton—
   seguiría filtrando con la lista vieja para siempre: cada proceso carga la
   lista al arrancar y nada más lo haría recargar.
   */
  override func handleAppMessage(
    _ messageData: Data,
    completionHandler: ((Data?) -> Void)?
  ) {
    guard String(data: messageData, encoding: .utf8) == "reloadBlocklist" else {
      completionHandler?(nil)
      return
    }
    do {
      try loadBlocklist()
      completionHandler?(Data("ok".utf8))
    } catch {
      os_log("No se pudo recargar la lista: %{public}@", log: log, type: .error,
             error.localizedDescription)
      completionHandler?(nil)
    }
  }

  /// Publica los contadores en el App Group para que la app los muestre.
  /// Solo números: ningún dominio sale de la extensión, ni siquiera a disco.
  private func publishDiagnostics() {
    guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return }
    defaults.set(packetsSeen, forKey: "diagPackets")
    defaults.set(queriesParsed, forKey: "diagQueries")
    defaults.set(blockedCount, forKey: "diagBlocked")
    defaults.set(ShieldBlocklist.shared.domainCount, forKey: "diagListCount")
    defaults.set(Date().timeIntervalSince1970, forKey: "diagAt")
  }

  // MARK: - Lista de bloqueo

  private func loadBlocklist() throws {
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: Self.appGroup)
    else {
      throw ShieldError.appGroupUnavailable
    }

    let url = container.appendingPathComponent(Self.blocklistFile)
    let version = UserDefaults(suiteName: Self.appGroup)?
      .string(forKey: "blocklistVersion") ?? ""

    let count = try ShieldBlocklist.shared.load(from: url, version: version)
    os_log("Lista cargada: %d dominios", log: log, type: .info, count)
  }

  // MARK: - Bucle de paquetes

  private func readPackets() {
    packetFlow.readPackets { [weak self] packets, _ in
      guard let self else { return }

      for packet in packets {
        self.handle(packet)
      }
      // readPackets entrega una tanda y hay que volver a pedir la siguiente.
      self.readPackets()
    }
  }

  private func handle(_ packet: Data) {
    packetsSeen += 1
    // Cada 10 paquetes: una foto del estado, sin ningún dato de navegación.
    // Va a UserDefaults del App Group para que la app pueda MOSTRARLO en
    // pantalla: pedirle a alguien que abra Consola.app y filtre logs no es un
    // camino de soporte razonable, ni siquiera para nosotros mismos.
    // `type: .default` y no `.info`, porque Consola oculta los info por defecto.
    if packetsSeen % 10 == 1 {
      publishDiagnostics()
      os_log(
        "Diagnóstico · paquetes:%d consultas:%d bloqueos:%d lista:%d",
        log: log, type: .default,
        packetsSeen, queriesParsed, blockedCount, ShieldBlocklist.shared.domainCount)
    }

    guard let query = DnsPacketParser.parseQuery(packet) else { return }
    queriesParsed += 1

    if ShieldBlocklist.shared.isBlocked(query.domain) {
      blockedCount += 1
      persistBlocked(domain: query.domain)
      let response = DnsPacketParser.buildNxDomainResponse(for: query)
      packetFlow.writePackets([response], withProtocols: [NSNumber(value: AF_INET)])
      return
    }

    forward(query)
  }

  /// Reenvía la consulta al resolver real. La conexión se crea desde la
  /// extensión, que por definición queda fuera del propio túnel.
  private func forward(_ query: DnsPacketParser.Query) {
    guard query.payload.count >= 2 else { return }
    let txid = UInt16(query.payload[0]) << 8 | UInt16(query.payload[1])

    pendingLock.lock()
    // La misma pasada aprovecha para purgar consultas vencidas: mantiene el
    // diccionario acotado sin necesidad de un timer.
    let cutoff = Date().addingTimeInterval(-Self.pendingTimeout)
    pending = pending.filter { $0.value.at > cutoff }
    pending[txid] = (query, Date())
    pendingLock.unlock()

    session().writeDatagram(query.payload) { error in
      if let error {
        os_log("Falló la consulta upstream: %{public}@", log: self.log, type: .error,
               error.localizedDescription)
      }
    }
  }

  /// Devuelve la sesión upstream, recreándola si el sistema la invalidó
  /// (cambio de red, fallo). Nunca una por consulta.
  private func session() -> NWUDPSession {
    if let existing = upstreamSession,
       existing.state != .cancelled, existing.state != .failed, existing.state != .invalid {
      return existing
    }

    upstreamSession?.cancel()
    let endpoint = NWHostEndpoint(hostname: Self.upstreamDns, port: "53")
    let fresh = createUDPSession(to: endpoint, from: nil)

    fresh.setReadHandler({ [weak self] datagrams, error in
      guard let self, error == nil, let datagrams else { return }
      for answer in datagrams {
        self.deliver(answer)
      }
    }, maxDatagrams: 32)

    upstreamSession = fresh
    return fresh
  }

  /// Casa una respuesta del resolver con su consulta pendiente por txid.
  private func deliver(_ answer: Data) {
    guard answer.count >= 12, answer[2] & 0x80 != 0 else { return }
    let txid = UInt16(answer[0]) << 8 | UInt16(answer[1])

    pendingLock.lock()
    let entry = pending.removeValue(forKey: txid)
    pendingLock.unlock()

    guard let entry else { return }
    let response = DnsPacketParser.wrapInUdpIp(query: entry.query, dnsPayload: answer)
    packetFlow.writePackets([response], withProtocols: [NSNumber(value: AF_INET)])
  }

  // MARK: - Estado compartido con la app

  /**
   Deja el bloqueo en el App Group para que la app pueda mostrarlo.

   La extensión corre en OTRO proceso: no puede emitir eventos al JS de la app
   como hace el módulo en Android. Sin este buzón compartido, el contador de
   bloqueos se quedaba en cero para siempre y el usuario no se enteraba nunca de
   que el escudo lo había protegido — que es justamente la prueba de que sirve.

   Se guarda una lista acotada de los últimos bloqueos. Esto sí incluye
   dominios, pero no sale del teléfono: vive en el contenedor compartido de la
   app, igual que las alertas del escáner.
   */
  private func persistBlocked(domain: String) {
    guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return }
    defaults.set(blockedCount, forKey: "blockedCount")

    let now = Date().timeIntervalSince1970 * 1000
    var recent = defaults.array(forKey: "recentBlocked") as? [[String: Any]] ?? []
    recent.insert(["domain": domain, "at": now], at: 0)
    if recent.count > Self.maxRecentBlocked {
      recent = Array(recent.prefix(Self.maxRecentBlocked))
    }
    defaults.set(recent, forKey: "recentBlocked")
  }

  private func updateStatus(_ status: String) {
    UserDefaults(suiteName: Self.appGroup)?.set(status, forKey: "shieldStatus")
  }
}

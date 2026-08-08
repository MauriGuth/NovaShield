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
  private static let tunnelAddress = "192.0.2.1"
  private static let tunnelDns = "192.0.2.2"

  /// Resolver upstream. Quad9 filtra dominios maliciosos por su cuenta, así que
  /// suma una segunda capa además de la lista local.
  private static let upstreamDns = "9.9.9.9"

  private let log = OSLog(subsystem: "ar.com.novasolutions.novashield", category: "DnsShield")
  private var blockedCount = 0

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

    let ipv4 = NEIPv4Settings(addresses: [Self.tunnelAddress], subnetMasks: ["255.255.255.255"])
    // Se rutea SOLO la IP del DNS interno: nada más entra al túnel.
    ipv4.includedRoutes = [
      NEIPv4Route(destinationAddress: Self.tunnelDns, subnetMask: "255.255.255.255")
    ]
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
    guard let query = DnsPacketParser.parseQuery(packet) else { return }

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

  private func persistBlocked(domain: String) {
    guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return }
    defaults.set(blockedCount, forKey: "blockedCount")
    defaults.set(domain, forKey: "lastBlockedDomain")
    defaults.set(Date().timeIntervalSince1970 * 1000, forKey: "lastBlockedAt")
  }

  private func updateStatus(_ status: String) {
    UserDefaults(suiteName: Self.appGroup)?.set(status, forKey: "shieldStatus")
  }
}

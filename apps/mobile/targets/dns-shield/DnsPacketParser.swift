import Foundation

/**
 Parseo y construcción de los paquetes que pasan por el túnel (iOS).

 Espejo exacto de DnsPacket.kt en Android: mismo criterio, mismos offsets,
 mismas respuestas. Solo hay que manejar IPv4 + UDP hacia el puerto 53, porque
 al túnel se le rutea únicamente la IP del DNS interno.

 Implementado desde los RFC 791/768/1035; no deriva de ninguna base GPL.
 */
enum DnsPacketParser {

  private static let protoUdp: UInt8 = 17

  struct Query {
    let sourceIp: [UInt8]
    let destIp: [UInt8]
    let sourcePort: UInt16
    let destPort: UInt16
    /// Payload DNS crudo, para reenviarlo tal cual al resolver upstream.
    let payload: Data
    let domain: String
    /// Offset dentro de `payload` donde termina la sección de pregunta.
    let questionEnd: Int
  }

  /// Devuelve nil si el paquete no es una consulta DNS que sepamos manejar.
  static func parseQuery(_ packet: Data) -> Query? {
    let bytes = [UInt8](packet)
    guard bytes.count >= 28 else { return nil }
    guard (bytes[0] >> 4) == 4 else { return nil } // IPv4

    let ipHeaderLength = Int(bytes[0] & 0x0F) * 4
    guard ipHeaderLength >= 20, bytes.count >= ipHeaderLength + 8 else { return nil }
    guard bytes[9] == protoUdp else { return nil }

    let sourceIp = Array(bytes[12..<16])
    let destIp = Array(bytes[16..<20])

    let udp = ipHeaderLength
    let sourcePort = readUInt16(bytes, udp)
    let destPort = readUInt16(bytes, udp + 2)
    guard destPort == 53 else { return nil }

    let udpLength = Int(readUInt16(bytes, udp + 4))
    let payloadLength = udpLength - 8
    let payloadStart = udp + 8
    guard payloadLength > 0, payloadStart + payloadLength <= bytes.count else { return nil }

    let payload = Data(bytes[payloadStart..<(payloadStart + payloadLength)])
    guard let question = readQuestion(payload) else { return nil }

    return Query(
      sourceIp: sourceIp,
      destIp: destIp,
      sourcePort: sourcePort,
      destPort: destPort,
      payload: payload,
      domain: question.domain,
      questionEnd: question.end
    )
  }

  /// Lee el QNAME de la primera pregunta y dónde termina la sección.
  /// No se siguen punteros de compresión: en una consulta no aparecen, y
  /// seguirlos a ciegas sería un DoS por bucle infinito.
  private static func readQuestion(_ dns: Data) -> (domain: String, end: Int)? {
    let bytes = [UInt8](dns)
    guard bytes.count >= 13 else { return nil }
    guard readUInt16(bytes, 4) >= 1 else { return nil } // QDCOUNT

    var labels: [String] = []
    var i = 12

    while i < bytes.count {
      let length = Int(bytes[i])

      if length == 0 {
        guard !labels.isEmpty else { return nil }
        let end = i + 1 + 4 // terminador + QTYPE + QCLASS
        guard end <= bytes.count else { return nil }
        return (labels.joined(separator: "."), end)
      }

      guard length & 0xC0 == 0, length <= 63, i + 1 + length <= bytes.count else { return nil }
      guard let label = String(bytes: bytes[(i + 1)..<(i + 1 + length)], encoding: .ascii) else {
        return nil
      }
      labels.append(label)
      i += 1 + length
    }
    return nil
  }

  /**
   Respuesta NXDOMAIN para una consulta bloqueada.

   El mensaje se TRUNCA al final de la pregunta: si la consulta traía un
   registro OPT de EDNS0 en la sección adicional, dejarlo mientras se pone
   ARCOUNT=0 produce un paquete malformado que el resolver descarta, y el
   bloqueo se convertiría en un timeout.
   */
  static func buildNxDomainResponse(for query: Query) -> Data {
    var dns = [UInt8](query.payload.prefix(query.questionEnd))

    // QR=1, se conservan OPCODE y RD; RA=1, RCODE=3 (NXDOMAIN).
    dns[2] = (dns[2] & 0x7D) | 0x80
    dns[3] = 0x83
    dns[4] = 0; dns[5] = 1  // una pregunta
    dns[6] = 0; dns[7] = 0  // sin respuestas
    dns[8] = 0; dns[9] = 0
    dns[10] = 0; dns[11] = 0

    return wrapInUdpIp(query: query, dnsPayload: Data(dns))
  }

  /// Envuelve un payload DNS en UDP+IPv4, invirtiendo origen y destino.
  static func wrapInUdpIp(query: Query, dnsPayload: Data) -> Data {
    let ipHeaderLength = 20
    let udpLength = 8 + dnsPayload.count
    let totalLength = ipHeaderLength + udpLength

    var packet = [UInt8](repeating: 0, count: totalLength)

    // — Cabecera IPv4 —
    packet[0] = 0x45                                  // versión 4, IHL 5
    packet[2] = UInt8(totalLength >> 8)
    packet[3] = UInt8(totalLength & 0xFF)
    packet[6] = 0x40                                  // don't fragment
    packet[8] = 64                                    // TTL
    packet[9] = protoUdp
    packet.replaceSubrange(12..<16, with: query.destIp)   // origen = el DNS consultado
    packet.replaceSubrange(16..<20, with: query.sourceIp) // destino = quien preguntó

    // — Cabecera UDP —
    let udp = ipHeaderLength
    writeUInt16(&packet, udp, query.destPort)
    writeUInt16(&packet, udp + 2, query.sourcePort)
    writeUInt16(&packet, udp + 4, UInt16(udpLength))
    // Checksum UDP en 0 = sin verificar, válido en IPv4.

    packet.replaceSubrange((udp + 8)..<totalLength, with: [UInt8](dnsPayload))

    writeChecksum(&packet, start: 0, length: ipHeaderLength, at: 10)
    return Data(packet)
  }

  // MARK: - Utilidades

  private static func readUInt16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
    (UInt16(bytes[offset]) << 8) | UInt16(bytes[offset + 1])
  }

  private static func writeUInt16(_ bytes: inout [UInt8], _ offset: Int, _ value: UInt16) {
    bytes[offset] = UInt8(value >> 8)
    bytes[offset + 1] = UInt8(value & 0xFF)
  }

  /// Checksum de Internet (RFC 1071).
  private static func writeChecksum(
    _ bytes: inout [UInt8], start: Int, length: Int, at offset: Int
  ) {
    bytes[offset] = 0
    bytes[offset + 1] = 0

    var sum: UInt32 = 0
    var i = start
    while i < start + length - 1 {
      sum += UInt32(readUInt16(bytes, i))
      i += 2
    }
    if i < start + length { sum += UInt32(bytes[i]) << 8 }

    while sum >> 16 != 0 { sum = (sum & 0xFFFF) + (sum >> 16) }
    let checksum = UInt16(~sum & 0xFFFF)

    writeUInt16(&bytes, offset, checksum)
  }
}

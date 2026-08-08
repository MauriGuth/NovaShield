package ar.com.novasolutions.novashield

import java.nio.ByteBuffer

/**
 * Parseo y construcción de los paquetes que pasan por el túnel.
 *
 * Solo hay que manejar un caso: IPv4 + UDP hacia el puerto 53. El túnel se
 * configura ruteando ÚNICAMENTE la IP del DNS falso, así que el resto del
 * tráfico del teléfono ni siquiera entra acá — no lo vemos, no lo tocamos y no
 * lo podríamos leer aunque quisiéramos. Eso es lo que hace que el escudo sea
 * un filtro de DNS y no una VPN que intercepta todo.
 */
object DnsPacket {

  private const val IPV4_VERSION = 4
  private const val PROTO_UDP = 17
  private const val PROTO_TCP = 6

  data class Query(
    val sourceIp: ByteArray,
    val destIp: ByteArray,
    val sourcePort: Int,
    val destPort: Int,
    /** Payload DNS crudo, para reenviarlo tal cual al resolver upstream. */
    val payload: ByteArray,
    /** Dominio consultado, ya decodificado. */
    val domain: String,
    val ipHeaderLength: Int,
    /** Offset dentro de `payload` donde termina la sección de pregunta. */
    val questionEnd: Int,
  ) {
    // data class con ByteArray: equals/hashCode se generan por referencia.
    // No los usamos, pero se sobrescriben para no dejar la trampa servida.
    override fun equals(other: Any?) = this === other
    override fun hashCode() = System.identityHashCode(this)
  }

  /** Devuelve null si el paquete no es una consulta DNS que sepamos manejar. */
  fun parseQuery(packet: ByteArray, length: Int): Query? {
    if (length < 28) return null // IPv4 (20) + UDP (8) mínimos

    val versionAndIhl = packet[0].toInt() and 0xFF
    if ((versionAndIhl shr 4) != IPV4_VERSION) return null

    val ipHeaderLength = (versionAndIhl and 0x0F) * 4
    if (ipHeaderLength < 20 || length < ipHeaderLength + 8) return null
    if ((packet[9].toInt() and 0xFF) != PROTO_UDP) return null

    val sourceIp = packet.copyOfRange(12, 16)
    val destIp = packet.copyOfRange(16, 20)

    val udp = ipHeaderLength
    val sourcePort = readUShort(packet, udp)
    val destPort = readUShort(packet, udp + 2)
    if (destPort != 53) return null

    val udpLength = readUShort(packet, udp + 4)
    val payloadLength = udpLength - 8
    val payloadStart = udp + 8
    if (payloadLength <= 0 || payloadStart + payloadLength > length) return null

    val payload = packet.copyOfRange(payloadStart, payloadStart + payloadLength)
    val question = readQuestion(payload) ?: return null

    return Query(
      sourceIp,
      destIp,
      sourcePort,
      destPort,
      payload,
      question.first,
      ipHeaderLength,
      question.second,
    )
  }

  /**
   * Lee el QNAME de la primera pregunta y devuelve (dominio, offset donde
   * termina la sección de pregunta, ya contando QTYPE y QCLASS).
   *
   * Formato DNS: secuencia de etiquetas (1 byte de longitud + bytes) terminada
   * en 0. No se siguen punteros de compresión: en una consulta no aparecen, y
   * seguirlos a ciegas sería un DoS por bucle infinito.
   */
  private fun readQuestion(dns: ByteArray): Pair<String, Int>? {
    if (dns.size < 13) return null // header (12) + al menos el terminador
    val questionCount = readUShort(dns, 4)
    if (questionCount < 1) return null

    val labels = StringBuilder()
    var i = 12
    while (i < dns.size) {
      val length = dns[i].toInt() and 0xFF

      if (length == 0) {
        if (labels.isEmpty()) return null
        val questionEnd = i + 1 + 4 // terminador + QTYPE + QCLASS
        if (questionEnd > dns.size) return null
        return labels.toString() to questionEnd
      }

      if (length and 0xC0 != 0) return null // puntero de compresión
      if (length > 63 || i + 1 + length > dns.size) return null

      if (labels.isNotEmpty()) labels.append('.')
      labels.append(String(dns, i + 1, length, Charsets.US_ASCII))
      i += 1 + length
    }
    return null
  }

  /**
   * Respuesta NXDOMAIN para una consulta bloqueada: le dice al sistema que el
   * dominio no existe, así la app que lo pidió falla rápido y limpio en vez de
   * quedar esperando un timeout.
   *
   * El mensaje se TRUNCA al final de la pregunta. Es obligatorio: si la
   * consulta traía un registro OPT de EDNS0 en la sección adicional, dejarlo
   * mientras se pone ARCOUNT=0 produce un paquete malformado que el resolver
   * del sistema descarta, y el bloqueo se convierte en un timeout.
   */
  fun buildNxDomainResponse(query: Query): ByteArray {
    val dns = query.payload.copyOf(query.questionEnd)

    // Flags: QR=1 (respuesta), se conservan OPCODE y RD; RA=1, RCODE=3.
    dns[2] = ((dns[2].toInt() and 0x7D) or 0x80).toByte()
    dns[3] = 0x83.toByte()
    // Una pregunta, cero respuestas, cero autoridad, cero adicionales.
    dns[4] = 0; dns[5] = 1
    dns[6] = 0; dns[7] = 0
    dns[8] = 0; dns[9] = 0
    dns[10] = 0; dns[11] = 0

    return wrapInUdpIp(query, dns)
  }

  /**
   * ¿`response` es de verdad la respuesta a `query`? Se exige transaction ID
   * idéntico, bit QR en 1 y la sección de pregunta byte a byte igual a la de
   * la consulta (el resolver la copia tal cual). Sin esto, cualquier datagrama
   * UDP que llegue al socket se blanquearía como respuesta DNS legítima y se
   * inyectaría en el teléfono como si viniera del resolver.
   */
  fun isResponseTo(query: Query, response: ByteArray, length: Int): Boolean {
    if (length < 12) return false
    if (response[0] != query.payload[0] || response[1] != query.payload[1]) return false
    if (response[2].toInt() and 0x80 == 0) return false // QR=0: es una consulta
    if (length < query.questionEnd) return false
    for (i in 12 until query.questionEnd) {
      if (response[i] != query.payload[i]) return false
    }
    return true
  }

  /** Envuelve un payload DNS en UDP+IPv4, invirtiendo origen y destino. */
  fun wrapInUdpIp(query: Query, dnsPayload: ByteArray): ByteArray {
    val ipHeaderLength = 20
    val udpLength = 8 + dnsPayload.size
    val totalLength = ipHeaderLength + udpLength
    val packet = ByteBuffer.allocate(totalLength)

    // — Cabecera IPv4 —
    packet.put(0x45)                       // versión 4, IHL 5
    packet.put(0)                          // DSCP/ECN
    packet.putShort(totalLength.toShort())
    packet.putShort(0)                     // identification
    packet.putShort(0x4000.toShort())      // don't fragment
    packet.put(64)                         // TTL
    packet.put(PROTO_UDP.toByte())
    packet.putShort(0)                     // checksum, se completa abajo
    packet.put(query.destIp)               // origen = el DNS al que se preguntó
    packet.put(query.sourceIp)             // destino = quien preguntó

    // — Cabecera UDP —
    packet.putShort(query.destPort.toShort())
    packet.putShort(query.sourcePort.toShort())
    packet.putShort(udpLength.toShort())
    packet.putShort(0)                     // checksum UDP: 0 = sin verificar (válido en IPv4)

    packet.put(dnsPayload)

    val bytes = packet.array()
    writeChecksum(bytes, 0, ipHeaderLength, 10)
    return bytes
  }

  /**
   * RST para un SYN de TCP al puerto 53 del alias.
   *
   * El resolver del sistema reintenta por TCP cuando una respuesta UDP viene
   * truncada (TC=1: respuestas grandes, DNSSEC). Ese SYN entra al túnel porque
   * la ruta /32 captura TODO el tráfico IP hacia el alias, no solo UDP — y
   * todavía no proxyamos DNS-over-TCP. Ignorarlo dejaría al resolver colgado
   * hasta su timeout con el dominio sin resolver y sin ningún error; el RST lo
   * hace fallar rápido y limpio, y el resolver cae a su siguiente estrategia.
   */
  fun buildTcpRstForSyn(packet: ByteArray, length: Int): ByteArray? {
    if (length < 40) return null // IPv4 (20) + TCP (20) mínimos

    val versionAndIhl = packet[0].toInt() and 0xFF
    if ((versionAndIhl shr 4) != IPV4_VERSION) return null
    val ipHeaderLength = (versionAndIhl and 0x0F) * 4
    if (ipHeaderLength < 20 || length < ipHeaderLength + 20) return null
    if ((packet[9].toInt() and 0xFF) != PROTO_TCP) return null

    val tcp = ipHeaderLength
    if (readUShort(packet, tcp + 2) != 53) return null // solo el puerto DNS

    val flags = packet[tcp + 13].toInt() and 0xFF
    if (flags and 0x02 == 0 || flags and 0x10 != 0) return null // solo SYN puro
    if (flags and 0x04 != 0) return null // nunca responder a un RST

    val sourceIp = packet.copyOfRange(12, 16)
    val destIp = packet.copyOfRange(16, 20)
    val sourcePort = readUShort(packet, tcp)
    val sequence = readUInt(packet, tcp + 4)

    val totalLength = 40
    val out = ByteBuffer.allocate(totalLength)

    // — IPv4 —
    out.put(0x45)
    out.put(0)
    out.putShort(totalLength.toShort())
    out.putShort(0)
    out.putShort(0x4000.toShort())
    out.put(64)
    out.put(PROTO_TCP.toByte())
    out.putShort(0)          // checksum IP, se completa abajo
    out.put(destIp)          // origen = el alias al que se conectaba
    out.put(sourceIp)

    // — TCP: RST+ACK, seq=0, ack=seq_entrante+1 (RFC 793 para un SYN) —
    out.putShort(53)
    out.putShort(sourcePort.toShort())
    out.putInt(0)
    out.putInt((sequence + 1L).toInt())
    out.put((5 shl 4).toByte()) // data offset 5 palabras, sin opciones
    out.put(0x14)               // RST | ACK
    out.putShort(0)             // window
    out.putShort(0)             // checksum TCP, se completa abajo
    out.putShort(0)             // urgent

    val bytes = out.array()
    writeChecksum(bytes, 0, 20, 10)
    writeTcpChecksum(bytes, ipHeaderLength = 20, tcpLength = 20)
    return bytes
  }

  /** Checksum TCP: pseudo-cabecera IPv4 (RFC 793) + segmento. */
  private fun writeTcpChecksum(data: ByteArray, ipHeaderLength: Int, tcpLength: Int) {
    val checksumOffset = ipHeaderLength + 16
    data[checksumOffset] = 0
    data[checksumOffset + 1] = 0

    var sum = 0L
    // Pseudo-cabecera: IPs de origen y destino, protocolo, longitud TCP.
    for (i in 12 until 20 step 2) sum += readUShort(data, i).toLong()
    sum += PROTO_TCP.toLong()
    sum += tcpLength.toLong()

    var i = ipHeaderLength
    while (i < ipHeaderLength + tcpLength - 1) {
      sum += readUShort(data, i).toLong()
      i += 2
    }
    if (i < ipHeaderLength + tcpLength) {
      sum += ((data[i].toInt() and 0xFF) shl 8).toLong()
    }

    while (sum shr 16 != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
    val checksum = sum.inv().toInt() and 0xFFFF
    data[checksumOffset] = (checksum shr 8).toByte()
    data[checksumOffset + 1] = (checksum and 0xFF).toByte()
  }

  private fun readUInt(data: ByteArray, offset: Int): Long =
    ((data[offset].toLong() and 0xFF) shl 24) or
      ((data[offset + 1].toLong() and 0xFF) shl 16) or
      ((data[offset + 2].toLong() and 0xFF) shl 8) or
      (data[offset + 3].toLong() and 0xFF)

  private fun readUShort(data: ByteArray, offset: Int): Int =
    ((data[offset].toInt() and 0xFF) shl 8) or (data[offset + 1].toInt() and 0xFF)

  /** Checksum de Internet (RFC 1071) escrito en `checksumOffset`. */
  private fun writeChecksum(data: ByteArray, start: Int, length: Int, checksumOffset: Int) {
    data[checksumOffset] = 0
    data[checksumOffset + 1] = 0

    var sum = 0L
    var i = start
    while (i < start + length - 1) {
      sum += readUShort(data, i).toLong()
      i += 2
    }
    if (i < start + length) sum += ((data[i].toInt() and 0xFF) shl 8).toLong()

    while (sum shr 16 != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
    val checksum = sum.inv().toInt() and 0xFFFF

    data[checksumOffset] = (checksum shr 8).toByte()
    data[checksumOffset + 1] = (checksum and 0xFF).toByte()
  }
}

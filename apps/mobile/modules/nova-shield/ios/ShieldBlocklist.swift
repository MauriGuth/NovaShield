import CryptoKit
import Foundation

/**
 Lista de bloqueo del Escudo DNS (iOS).

 El archivo que baja la app es un buffer binario con los SHA-256 de cada
 dominio truncados a 8 bytes y ORDENADOS ascendentemente. Se resuelve con
 búsqueda binaria sobre el `Data` mapeado en memoria: sin red, sin parsear
 texto y sin asignar por consulta, que importa porque esto corre en el camino
 de cada resolución DNS del teléfono y dentro de una extensión con un techo de
 memoria de ~50 MB.

 La canonicalización y el troceo por dominios padre tienen que coincidir
 EXACTAMENTE con packages/shared/src/domain.ts y con Blocklist.kt; si divergen,
 el escudo deja pasar dominios bloqueados sin ningún error visible.

 Este archivo se compila tanto en la app como en la extensión de red, por eso
 no depende de nada del módulo de Expo.
 */
public final class ShieldBlocklist {

  public static let hashBytes = 8
  public static let shared = ShieldBlocklist()

  private var hashes = Data()
  private let lock = NSLock()

  public private(set) var version: String = ""

  public var domainCount: Int {
    lock.lock(); defer { lock.unlock() }
    return hashes.count / Self.hashBytes
  }

  private init() {}

  /// Carga la lista desde disco. Devuelve cuántos dominios quedaron activos.
  @discardableResult
  public func load(from url: URL, version: String) throws -> Int {
    // mappedIfSafe: el kernel pagina el archivo bajo demanda en vez de
    // copiarlo entero al heap, que es lo que mantiene a la extensión lejos
    // del límite de memoria.
    let data = try Data(contentsOf: url, options: [.mappedIfSafe])

    guard data.count % Self.hashBytes == 0 else {
      throw ShieldError.corruptBlocklist(bytes: data.count)
    }

    lock.lock()
    hashes = data
    self.version = version
    lock.unlock()

    return data.count / Self.hashBytes
  }

  /// ¿El host consultado —o alguno de sus dominios padre— está bloqueado?
  /// Bloquear `ejemplo.com` bloquea también `login.ejemplo.com`.
  public func isBlocked(_ host: String) -> Bool {
    let canonical = Self.canonicalDomain(host)
    guard !canonical.isEmpty else { return false }

    // omittingEmptySubsequences: false — el split de Swift descarta labels
    // vacíos y el de TS/Kotlin no. Sin esto, "a..ejemplo.com" genera juegos de
    // claves distintos en cada plataforma.
    let parts = canonical.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count >= 2 else { return false }

    // Del más específico al más general, igual que domainLookupKeys().
    for index in 0...(parts.count - 2) {
      let candidate = parts[index...].joined(separator: ".")
      if contains(Self.hashPrefix(candidate)) { return true }
    }
    return false
  }

  /// Minúsculas, sin punto final y sin puerto. Espejo de canonicalDomain().
  ///
  /// El puerto se compara contra dígitos ASCII, no contra `isNumber`, que
  /// acepta dígitos Unicode y hasta fracciones (½): con `isNumber` un host como
  /// "sitio:٤٢" se canonicalizaría distinto que del lado TS.
  static func canonicalDomain(_ host: String) -> String {
    var value = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !value.hasPrefix("[") else { return value }

    while value.hasSuffix(".") { value.removeLast() }

    if let colon = value.lastIndex(of: ":"), colon != value.startIndex {
      let port = value[value.index(after: colon)...]
      if !port.isEmpty, port.allSatisfy({ $0.isASCII && $0.isNumber }) {
        value = String(value[..<colon])
      }
    }
    return value
  }

  static func hashPrefix(_ domain: String) -> [UInt8] {
    let digest = SHA256.hash(data: Data(domain.utf8))
    return Array(digest.prefix(hashBytes))
  }

  /// Búsqueda binaria sobre el buffer ordenado.
  private func contains(_ target: [UInt8]) -> Bool {
    lock.lock(); defer { lock.unlock() }

    return hashes.withUnsafeBytes { raw -> Bool in
      guard let base = raw.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
        return false
      }
      var low = 0
      var high = hashes.count / Self.hashBytes - 1

      while low <= high {
        let mid = (low + high) / 2
        let offset = mid * Self.hashBytes

        var comparison = 0
        for i in 0..<Self.hashBytes {
          let a = Int(base[offset + i])
          let b = Int(target[i])
          if a != b { comparison = a - b; break }
        }

        if comparison == 0 { return true }
        if comparison < 0 { low = mid + 1 } else { high = mid - 1 }
      }
      return false
    }
  }
}

public enum ShieldError: Error, LocalizedError {
  case corruptBlocklist(bytes: Int)
  case appGroupUnavailable
  case tunnelUnavailable(String)

  public var errorDescription: String? {
    switch self {
    case .corruptBlocklist(let bytes):
      return "Lista de bloqueo corrupta: \(bytes) bytes no es múltiplo de \(ShieldBlocklist.hashBytes)."
    case .appGroupUnavailable:
      return "No se pudo acceder al contenedor compartido con la extensión de red."
    case .tunnelUnavailable(let reason):
      return "No se pudo configurar el escudo: \(reason)"
    }
  }
}

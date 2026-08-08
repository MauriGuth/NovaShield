import Foundation
import LocalAuthentication
import UIKit

/**
 Señales de postura de seguridad del dispositivo (Escáner del Dispositivo, iOS).

 Todo es lectura local sin permisos ni prompts: `canEvaluatePolicy` NO muestra
 ningún diálogo (solo evaluar la política lo haría). Las señales se evalúan en
 la app con packages/shared/src/device.ts y no salen del teléfono — a lo sumo
 el score numérico, si el usuario usa Modo Familia.
 */
enum DevicePosture {

  static func collect() -> [String: Any?] {
    return [
      "platform": "ios",
      "osVersion": UIDevice.current.systemVersion,
      "screenLock": hasPasscode(),
      "biometrics": hasBiometrics(),
      "rooted": JailbreakProbe.isLikelyJailbroken(),
    ]
  }

  /// ¿Hay código de desbloqueo configurado? `.deviceOwnerAuthentication`
  /// cubre código O biometría; sin prompt porque solo se consulta canEvaluate.
  private static func hasPasscode() -> Bool {
    var error: NSError?
    return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
  }

  private static func hasBiometrics() -> Bool {
    var error: NSError?
    return LAContext().canEvaluatePolicy(
      .deviceOwnerAuthenticationWithBiometrics, error: &error)
  }
}

/**
 Heurísticas de jailbreak propias, best-effort: rastros de los gestores de
 paquetes clásicos y escritura fuera del sandbox. Un jailbreak moderno que se
 esconde no se delata acá — el objetivo es avisar al usuario común (o al que
 compró el equipo usado) que las protecciones del sistema no están intactas,
 no ganar una carrera armamentística. La app INFORMA, nunca bloquea.
 */
enum JailbreakProbe {

  private static let suspiciousPaths = [
    "/Applications/Cydia.app",
    "/Applications/Sileo.app",
    "/Applications/Zebra.app",
    "/Library/MobileSubstrate/MobileSubstrate.dylib",
    "/usr/sbin/sshd",
    "/etc/apt",
    "/private/var/lib/apt",
    "/bin/bash",
  ]

  static func isLikelyJailbroken() -> Bool {
    #if targetEnvironment(simulator)
      return false
    #else
      for path in suspiciousPaths where FileManager.default.fileExists(atPath: path) {
        return true
      }
      return canWriteOutsideSandbox()
    #endif
  }

  /// En un iPhone sin jailbreak, escribir en /private está prohibido por el
  /// sandbox: si esto tiene éxito, las protecciones no están.
  private static func canWriteOutsideSandbox() -> Bool {
    let probe = "/private/novashield-\(UUID().uuidString).txt"
    do {
      try "probe".write(toFile: probe, atomically: true, encoding: .utf8)
      try? FileManager.default.removeItem(atPath: probe)
      return true
    } catch {
      return false
    }
  }
}

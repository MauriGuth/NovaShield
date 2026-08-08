import IdentityLookup
import Foundation

/**
 Protección de Mensajes para iOS.

 LÍMITES DEL SISTEMA (documentados en docs/decisiones-tecnicas.md, no son
 decisiones nuestras):
 - Solo ve SMS/MMS/RCS de remitentes que NO están en los contactos. Nunca ve
   iMessage ni mensajes de gente conocida.
 - Solo puede CLASIFICAR el mensaje en una carpeta: no puede alertar, no puede
   notificar y no puede avisarle a la app Nova Shield. Por eso en iOS el aviso
   en tiempo real lo da el Escudo DNS al momento del click, no este filtro.
 - El usuario tiene que activarlo a mano en Ajustes y solo puede haber un
   filtro activo por dispositivo.

 Todo el análisis ocurre acá adentro, contra la misma lista local que usa el
 escudo: el contenido de los mensajes no sale del teléfono ni se envía a
 ningún servidor. (IdentityLookup permite diferir la consulta a un servidor
 propio; se decidió NO hacerlo porque implicaría recibir el texto completo de
 los SMS, incluidos códigos de verificación bancarios.)
 */
final class MessageFilterExtension: ILMessageFilterExtension {}

extension MessageFilterExtension: ILMessageFilterQueryHandling {

  func handle(
    _ queryRequest: ILMessageFilterQueryRequest,
    context: ILMessageFilterExtensionContext,
    completion: @escaping (ILMessageFilterQueryResponse) -> Void
  ) {
    let response = ILMessageFilterQueryResponse()
    let body = queryRequest.messageBody ?? ""

    guard !body.isEmpty else {
      response.action = .none
      completion(response)
      return
    }

    loadBlocklistIfNeeded()

    if containsBlockedDomain(body) {
      // .junk manda el mensaje a la carpeta de no deseados. Es lo máximo que
      // permite el sistema: no hay forma de mostrar una alerta desde acá.
      response.action = .junk
    } else {
      // .none = "no tengo información": el mensaje llega normal. Se prefiere
      // sobre .allow para no interferir con el filtrado propio de iOS.
      response.action = .none
    }

    completion(response)
  }

  // MARK: - Análisis local

  private func loadBlocklistIfNeeded() {
    // Se recarga cuando la versión publicada en el App Group difiere de la
    // cargada, no solo cuando no hay nada: este proceso puede vivir semanas y
    // "tener una lista" no es lo mismo que tener la vigente.
    let published = UserDefaults(suiteName: "group.ar.com.novasolutions.novashield")?
      .string(forKey: "blocklistVersion") ?? ""
    let loaded = ShieldBlocklist.shared.version
    guard ShieldBlocklist.shared.domainCount == 0 || loaded != published else { return }

    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group.ar.com.novasolutions.novashield")
    else { return }

    let url = container.appendingPathComponent("blocklist.bin")
    try? ShieldBlocklist.shared.load(from: url, version: published)
  }

  /// ¿El texto trae algún dominio que esté en la lista de bloqueo?
  private func containsBlockedDomain(_ text: String) -> Bool {
    // Se ignoran para no confundir "archivo.pdf" con un dominio.
    let ignoredTlds: Set<String> = ["jpg", "png", "pdf", "doc", "mp4", "gif"]

    let pattern = #"[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return false }

    let range = NSRange(text.startIndex..., in: text)
    for match in regex.matches(in: text, range: range) {
      guard let matchRange = Range(match.range, in: text) else { continue }

      let candidate = String(text[matchRange])
        .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?"))

      let tld = candidate.split(separator: ".").last.map(String.init)?.lowercased() ?? ""
      if tld.count < 2 || ignoredTlds.contains(tld) { continue }

      if ShieldBlocklist.shared.isBlocked(candidate) { return true }
    }
    return false
  }
}

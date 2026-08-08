/**
 * Extensión de red del Escudo DNS (iOS).
 *
 * El App Group es lo que permite que la extensión lea la lista de bloqueo que
 * descargó la app: son dos procesos distintos y no comparten sandbox.
 * Debe coincidir exactamente con NovaShieldModule.swift.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
  type: 'network-packet-tunnel',
  name: 'DnsShield',
  entitlements: {
    'com.apple.developer.networking.networkextension': ['packet-tunnel-provider'],
    'com.apple.security.application-groups': ['group.ar.com.novasolutions.novashield'],
  },
});

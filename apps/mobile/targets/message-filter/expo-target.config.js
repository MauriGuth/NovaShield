/**
 * Filtro de SMS de remitentes desconocidos (iOS).
 *
 * Comparte el App Group con la app para leer la misma lista de bloqueo que usa
 * el Escudo DNS. No lleva entitlement de red: el sistema no le da acceso.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
  type: 'message-filter',
  name: 'MessageFilter',
  entitlements: {
    'com.apple.security.application-groups': ['group.ar.com.novasolutions.novashield'],
  },
});

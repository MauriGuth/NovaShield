# Nova Shield — guía para agentes

Monorepo npm workspaces: `apps/mobile` (Expo SDK 57 + expo-router, más `modules/` con el módulo nativo Kotlin/Swift y `targets/` con las extensiones de iOS), `apps/backend` (NestJS 11), `packages/shared` (contrato de API; se compila con `prepare` al hacer `npm install`).

## Comandos

- `npm install` en la raíz (nunca dentro de un workspace suelto).
- Backend: `npm run backend` (dev) · `npm run backend:test` · `npm run backend:build`.
- Mobile: `npm run mobile` · `npm run typecheck --workspace apps/mobile`.
- Endpoints (prefijo global `v1`): `POST /v1/analyze`, `POST /v1/messages/analyze`, `GET /v1/shield/metadata`, `GET /v1/shield/blocklist`, `POST /v1/family`, `POST /v1/family/join`, `GET /v1/family/me`, `PUT /v1/family/me/status`, `POST /v1/family/leave`, `GET /v1/health`.
- Persistencia: TypeORM con better-sqlite3 en dev/tests (`FAMILY_DB_PATH`, `:memory:` en e2e) y PostgreSQL con `DATABASE_URL` en producción. Usar SOLO tipos de columna portables entre ambos (nada de `uuid`, `timestamptz`, `enum` como tipo de columna).
- El código nativo no se compila acá. Lo verificable sin toolchain: `npx expo-modules-autolinking search -p android` / `-p apple` (resuelve módulo y clase) y `npx expo config --type prebuild` (targets registrados).

## Reglas del proyecto

- Textos de usuario en español rioplatense, simples y educativos: cada razón de un veredicto se muestra tal cual al usuario.
- Tipos compartidos SIEMPRE en `packages/shared` — no duplicar interfaces entre app y backend.
- zod está fijado a la versión que hoistea Expo (3.25.x); en el backend importar `zod/v4` (el helper del SDK de Anthropic tipa contra ese subpath). No agregar zod 4.x local.
- Fuentes de amenazas: solo las de licencia comercial apta (PhishTank, URLhaus, HaGeZi, Web Risk). Google Safe Browsing y VirusTotal free están PROHIBIDAS en producción (ToS no comercial) — ver docs/decisiones-tecnicas.md.
- Las listas de PhishTank indexan la URL completa (host+path+query); nunca indexar la forma sin query de entradas con query (falso positivo catastrófico con open-redirects tipo google.com/?url=evil).
- `apps/mobile/ios` y `apps/mobile/android` no se versionan (CNG/prebuild). Los targets nativos futuros (Network Extension, VpnService) van como config plugins + carpetas de target dedicadas.
- La app debe correr también sin el módulo de share intent (Expo Go): `src/lib/use-shared-text.ts` es el único punto de contacto con expo-share-intent, y `_layout.tsx` es el único consumidor (navega a /scanner con el texto por parámetro; `+native-intent.ts` redirige el deep link de la share extension de iOS).
- Toda expansión de redirecciones pasa por `src/analysis/ssrf.ts`. No agregar fetch de URLs del usuario sin pasar por `isForbiddenHost` + `assertPublicHost`; bloquear literales IPv6 mapeados a IPv4 (`::ffff:…`) es obligatorio, no opcional.
- El LLM nunca puede bajar un veredicto a "seguro" si hay razones `critical` de las capas deterministas (prompt injection vía la URL, y el texto de un mensaje es todavía más atacante-controlado).
- **`canonicalDomain()` está implementada tres veces** (`packages/shared/src/domain.ts`, `Blocklist.kt`, `ShieldBlocklist.swift`) y las tres tienen que producir el mismo string byte a byte antes de hashear. Una divergencia no tira ningún error: el escudo simplemente deja de bloquear. Tocar una es tocar las tres.
- El escudo hace matching **local**: el backend distribuye hashes y nunca recibe consultas por dominio. No agregar ningún endpoint de "confirmación" ni telemetría por dominio — es la promesa de privacidad del producto.
- La blocklist del escudo lleva SOLO dominios maliciosos. Bloquear publicidad viola la política de Play y arriesga la remoción de la app.
- No derivar código de DNS66 / DNSNet / NetGuard: son GPL-3.0 y este producto es propietario.
- `apps/mobile/modules/nova-shield/ios/NovaShield.podspec` es obligatorio: sin podspec, expo-modules-autolinking descarta el lado iOS del módulo en silencio, sin ningún error.
- **Nunca fail-open.** Si una pieza del escudo no puede operar (lista vacía, descarga corrupta, fuentes sin cargar), tiene que negarse a operar de forma visible (503, estado `inactive`, veredicto `unknown`) — jamás seguir "activa" sin bloquear ni declarar `safe` sin haber verificado. Ver la sección de la revisión adversarial en docs/decisiones-tecnicas.md.
- Los servicios de Android que el sistema arranca solo (VpnService sticky, NotificationListener) no pueden asumir que JS cargó nada: siempre `Blocklist.ensureLoaded()` antes de operar.
- En iOS la app y las extensiones son procesos distintos con singletons distintos: cambiar la lista exige publicar la versión en el App Group y avisar al túnel (`sendProviderMessage`).
- **El Modo Familia comparte SOLO booleanos, contadores y el score** (`FamilyMemberStatus`). Agregar ahí un dominio, un texto de mensaje o una ubicación rompe la promesa del producto y además arriesga que Play clasifique la app como stalkerware — lo que prohibiría compartir entre adultos aunque haya consentimiento. Nunca posicionar el feature con lenguaje de vigilancia.
- El escáner del dispositivo **no afirma lo que no puede verificar**: `Settings.Global.ADB_ENABLED` y `DEVELOPMENT_SETTINGS_ENABLED` siempre devuelven 0 para apps de terceros, así que esas señales no se reportan. Una señal `undefined` nunca puede producir un chequeo en verde.
- El escáner es on-device y sin red: no agregar ningún fetch en `device-scan.ts` ni en `DevicePosture.{kt,swift}`.
- Los scripts de la raíz recompilan `packages/shared` con hooks `pre*`: si agregás un script nuevo que consuma el paquete, agregá su `pre<script>` correspondiente.
- **Monetización**: lo que evita un daño inmediato NO se cobra (análisis a pedido, alertas, score, escáner del dispositivo). Se cobra la protección continua. El tope del plan gratuito degrada a las capas locales (`deepAnalysis: false`) pero SIEMPRE devuelve un veredicto — nunca deja a alguien sin respuesta frente a un enlace. Unirse a una familia es gratis; solo crearla exige plan.
- Los pagos van por StoreKit/Play Billing vía RevenueCat. Meter un link de pago externo o Stripe dentro de la app viola la guideline 3.1.1 de Apple y la política de pagos de Play.
- Los identificadores de entitlement (`premium`, `familia`) viven en `packages/shared/src/plans.ts` y tienen que coincidir con el panel de RevenueCat.
- Las extensiones de iOS NO enlazan los pods de Expo: ningún archivo bajo `apps/mobile/targets/` puede importar `ExpoModulesCore`. El código Swift compartido entre la app y las extensiones va duplicado (`modules/nova-shield/ios/ShieldBlocklist.swift` y `targets/_shared/ShieldBlocklist.swift`) y `native-parity.spec.ts` verifica que sean idénticos. **No usar symlinks**: `@bacons/apple-targets` agrega la carpeta del target como file-system synchronized group y Xcode resuelve el symlink arrastrando todo el directorio apuntado al target.

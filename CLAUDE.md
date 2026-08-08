# Nova Shield — guía para agentes

Monorepo npm workspaces: `apps/mobile` (Expo SDK 57 + expo-router), `apps/backend` (NestJS 11), `packages/shared` (contrato de API; se compila con `prepare` al hacer `npm install`).

## Comandos

- `npm install` en la raíz (nunca dentro de un workspace suelto).
- Backend: `npm run backend` (dev) · `npm run backend:test` · `npm run backend:build`.
- Mobile: `npm run mobile` · `npm run typecheck --workspace apps/mobile`.
- El backend expone `POST /v1/analyze` y `GET /v1/health` (prefijo global `v1`).

## Reglas del proyecto

- Textos de usuario en español rioplatense, simples y educativos: cada razón de un veredicto se muestra tal cual al usuario.
- Tipos compartidos SIEMPRE en `packages/shared` — no duplicar interfaces entre app y backend.
- zod está fijado a la versión que hoistea Expo (3.25.x); en el backend importar `zod/v4` (el helper del SDK de Anthropic tipa contra ese subpath). No agregar zod 4.x local.
- Fuentes de amenazas: solo las de licencia comercial apta (PhishTank, URLhaus, HaGeZi, Web Risk). Google Safe Browsing y VirusTotal free están PROHIBIDAS en producción (ToS no comercial) — ver docs/decisiones-tecnicas.md.
- Las listas de PhishTank indexan la URL completa (host+path+query); nunca indexar la forma sin query de entradas con query (falso positivo catastrófico con open-redirects tipo google.com/?url=evil).
- `apps/mobile/ios` y `apps/mobile/android` no se versionan (CNG/prebuild). Los targets nativos futuros (Network Extension, VpnService) van como config plugins + carpetas de target dedicadas.
- La app debe correr también sin el módulo de share intent (Expo Go): `src/lib/use-shared-text.ts` es el único punto de contacto con expo-share-intent, y `_layout.tsx` es el único consumidor (navega a /scanner con el texto por parámetro; `+native-intent.ts` redirige el deep link de la share extension de iOS).
- Toda expansión de redirecciones pasa por `src/analysis/ssrf.ts`. No agregar fetch de URLs del usuario sin pasar por `isForbiddenHost` + `assertPublicHost`; bloquear literales IPv6 mapeados a IPv4 (`::ffff:…`) es obligatorio, no opcional.
- El LLM nunca puede bajar un veredicto a "seguro" si hay razones `critical` de las capas deterministas (prompt injection vía la URL).
- Los scripts de la raíz recompilan `packages/shared` con hooks `pre*`: si agregás un script nuevo que consuma el paquete, agregá su `pre<script>` correspondiente.

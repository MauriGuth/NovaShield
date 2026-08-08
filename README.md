# Nova Shield 🛡️

App móvil de ciberseguridad personal contra estafas, fraudes y hackeos (iOS & Android), de Nova Solutions. Analiza enlaces antes de que los abras, vigila la red y detecta mensajes sospechosos — avisando en el momento, antes de que el daño ocurra.

Estado: **Fase 2** — Escudo DNS + Protección de Mensajes, sobre el MVP de Fase 1 (Escáner de Enlaces + Score de Seguridad + Centro de Alertas). Ver [hoja de ruta](docs/decisiones-tecnicas.md#hoja-de-ruta).

## Estructura

```
apps/
  mobile/
    src/          App Expo (SDK 57, React Native 0.86, expo-router)
    modules/      Módulo nativo NovaShield (Kotlin + Swift) vía Expo Modules API
    targets/      Extensiones de iOS (packet tunnel, message filter) vía @bacons/apple-targets
  backend/        API NestJS: análisis de URLs y de mensajes + distribución de la blocklist
packages/
  shared/         Contrato de la API y tipos compartidos
docs/             Decisiones técnicas y restricciones de plataforma verificadas
```

## Requisitos

- Node 20+ y npm 10+
- Para builds nativos: cuenta de Expo (EAS) — la app usa dev client, no Expo Go

## Arranque rápido

```bash
npm install            # instala todo el monorepo y compila packages/shared

# Backend (puerto 3000)
npm run backend        # nest start --watch
curl -X POST localhost:3000/v1/analyze -H 'content-type: application/json' \
  -d '{"url":"https://bit.ly/ejemplo"}'

# App móvil
npm run mobile         # expo start (dev client)
```

Para probar la app contra el backend desde un dispositivo físico:

```bash
EXPO_PUBLIC_API_URL=http://<IP-de-tu-máquina>:3000 npm run mobile
```

## Backend: motor de 3 capas

`POST /v1/analyze` recibe `{ "url": "<link o texto pegado>" }` y devuelve un veredicto (`malicious | suspicious | safe | unknown`) con razones educativas en español:

1. **Listas de amenazas** — PhishTank (URLs exactas) + HaGeZi TIF (dominios), en memoria con refresh cada 2 h. URLhaus se suma configurando `URLHAUS_AUTH_KEY`.
2. **Google Web Risk** — verificación autoritativa; se activa con `WEB_RISK_API_KEY`.
3. **Heurísticas + IA** — acortadores (con expansión server-side), punycode, imitación de marcas argentinas, TLDs sospechosos, urgencia; clasificación de intención con Claude si `ANTHROPIC_API_KEY` está configurada.

Variables de entorno en [`apps/backend/.env.example`](apps/backend/.env.example).

## Escudo DNS

El escudo corta la conexión en el momento en que el teléfono pregunta por un dominio de estafa, sin importar desde qué app venga el click. El filtrado es **100 % local**: el backend distribuye la lista, no responde consultas.

- `GET /v1/shield/metadata` → versión, cantidad de dominios y tamaño de la lista, para avisar cuántos MB va a consumir antes de bajarla.
- `GET /v1/shield/blocklist` → hashes SHA-256 truncados a 8 bytes, ordenados, en binario (~1,3 MB). Con `ETag`: el dispositivo que ya tiene la versión vigente recibe un 304.

El teléfono guarda ese archivo y hace búsqueda binaria contra él. Nunca le pregunta al servidor por un dominio en particular, así que el backend no puede reconstruir la navegación de nadie.

- **Android**: `VpnService` como filtro de DNS únicamente (no túnel de tráfico) — `apps/mobile/modules/nova-shield/android`.
- **iOS**: `NEPacketTunnelProvider` en `apps/mobile/targets/dns-shield`, con la lista compartida por App Group. Se descartó `NEDNSSettingsManager` porque obliga a apuntar el DNS del sistema a un resolver remoto propio: haría el filtrado del lado del servidor y expondría toda la navegación del usuario.

La canonicalización de dominios (`packages/shared/src/domain.ts`) está espejada en Kotlin y Swift: **si las tres divergen, el escudo falla en silencio**. Cualquier cambio ahí toca los tres archivos y sus tests.

## Protección de Mensajes

`POST /v1/messages/analyze` recibe `{ "text": "...", "source": "sms|notification|manual" }` y cruza tres señales: los enlaces del mensaje (máximo 3, con el motor de análisis completo), patrones de estafa argentinos (pedido del código de WhatsApp, cuento del familiar con número nuevo, CBU, ARCA, paquete en aduana, corte de servicio…) y, en la franja ambigua, clasificación con Claude.

En el dispositivo:

- **Android** — `NotificationListenerService` lee las notificaciones de mensajería y contrasta los dominios contra la **misma lista local** del escudo: el contenido de las notificaciones no sale del teléfono. El análisis profundo corre solo si el usuario abre la app y lo pide.
- **iOS** — `ILMessageFilterExtension` (`apps/mobile/targets/message-filter`), limitado por Apple a SMS de remitentes desconocidos y a clasificar en carpetas: no puede alertar en tiempo real. No prometer eso en marketing.

```bash
npm run backend:test   # unit tests
npm run backend:build
npm run typecheck      # typecheck de todos los workspaces
```

Los módulos nativos no compilan en Expo Go ni en el bundler: se verifican con
`npx expo-modules-autolinking search -p android|apple` (resuelve módulo y clase) y
`npx expo config --type prebuild` (confirma que los targets quedan registrados).

## Decisiones y restricciones de plataforma

Las restricciones reales de iOS/Android (escudo DNS, filtro de SMS, políticas de las tiendas) y las licencias de las fuentes de amenazas están documentadas y verificadas en [`docs/decisiones-tecnicas.md`](docs/decisiones-tecnicas.md). Leer antes de comprometer alcance o marketing.

---

© Nova Solutions SAS · Neuquén, Argentina

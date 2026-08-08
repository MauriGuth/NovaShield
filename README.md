# Nova Shield 🛡️

App móvil de ciberseguridad personal contra estafas, fraudes y hackeos (iOS & Android), de Nova Solutions. Analiza enlaces antes de que los abras, vigila la red y detecta mensajes sospechosos — avisando en el momento, antes de que el daño ocurra.

Estado: **Fase 1 · MVP** — Escáner de Enlaces + Score de Seguridad + Centro de Alertas (ver [hoja de ruta](docs/decisiones-tecnicas.md#hoja-de-ruta)).

## Estructura

```
apps/
  mobile/     App Expo (SDK 57, React Native 0.86, expo-router)
  backend/    API NestJS: motor de análisis de URLs en 3 capas
packages/
  shared/     Contrato de la API y tipos compartidos
docs/         Decisiones técnicas y restricciones de plataforma verificadas
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

```bash
npm run backend:test   # unit tests
npm run backend:build
npm run typecheck      # typecheck de todos los workspaces
```

## Decisiones y restricciones de plataforma

Las restricciones reales de iOS/Android (escudo DNS, filtro de SMS, políticas de las tiendas) y las licencias de las fuentes de amenazas están documentadas y verificadas en [`docs/decisiones-tecnicas.md`](docs/decisiones-tecnicas.md). Leer antes de comprometer alcance o marketing.

---

© Nova Solutions SAS · Neuquén, Argentina

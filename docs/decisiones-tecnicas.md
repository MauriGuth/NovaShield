# Decisiones técnicas y restricciones de plataforma

Restricciones verificadas el 08-08-2026 contra documentación oficial (Apple TN3134/TN3120, App Store Review Guidelines, políticas de Google Play, precios y licencias de los proveedores de threat intelligence). Los límites de plataforma cambian: revalidar en cada beta mayor de iOS/Android.

## Stack

| Capa | Elección | Nota |
|---|---|---|
| App | Expo SDK 57 (RN 0.86) + CNG/prebuild + dev client + EAS Build | Expo Go no soporta los módulos nativos del producto |
| Targets iOS | Swift vía `expo-apple-targets` (share ya cubierto por `expo-share-intent`) | Validar pipeline de firma multi-target en EAS temprano |
| Nativo Android | Expo Modules (Kotlin): VpnService (Fase 2) + NotificationListener (Fase 2) | El componente nativo más caro del proyecto |
| Backend | NestJS 11 + (PostgreSQL cuando lleguen cuentas) en Railway | Hoy el análisis es stateless |
| Suscripciones | RevenueCat o StoreKit2/Play Billing (Fase 4) | |

## El escudo DNS (Fase 2) — camino verificado

- **iOS**: `NEDNSSettingsManager` (iOS 14+, DoH contra resolver propio) como modo por defecto — sin ícono VPN, capability self-service. Plan B: `NEPacketTunnelProvider` (VPN local, patrón AdGuard/Lockdown; extensión Swift con techo ~50 MB RAM). `NEDNSProxyProvider` DESCARTADO: solo dispositivos MDM.
- **Apple guideline 5.4**: apps con Network Extension solo se publican desde cuenta **Organization** (trámite D-U-N-S: iniciarlo YA). Prohibido vender/compartir datos de tráfico. Disclosure previa al uso.
- **Android**: `VpnService` con proxy DNS local (Kotlin). Permitido por Play bajo "device security" con declaración obligatoria en Play Console. La lista debe bloquear SOLO dominios maliciosos — bloquear publicidad viola la política y arriesga remoción.
- Otra VPN activa pisa el escudo en ambas plataformas: detectar y mostrar "protección pausada".

## Protección de mensajes (Fase 2) — límites duros

- **iOS SMS** (`ILMessageFilterExtension`): solo remitentes desconocidos (nunca iMessage ni contactos); solo clasifica en carpetas — NO puede alertar en tiempo real ni avisarle a la app; activación manual en Ajustes; un solo filtro activo por equipo. No prometer "alerta de SMS en tiempo real" en iOS.
- **iOS correo**: NO existe API de filtrado de mail. El módulo "filtro de correos" del anteproyecto se reformuló: el escudo DNS atrapa el click + escáner manual/compartir.
- **Android**: permisos SMS prohibidos para apps nuevas (la excepción anti-phishing de Play exige track record certificado tipo AV-TEST). Vía real v1: `NotificationListenerService` con análisis on-device — además es lo único que ve links de WhatsApp, el vector n.º 1 en Argentina. Contenido de notificaciones = dato sensible: prominent disclosure + no subir contenido a servidores.
- **iOS notificaciones de terceros**: imposible por diseño. La paridad real la da el escudo DNS.

## Fuentes de amenazas — licencias verificadas

| Fuente | Licencia | Uso |
|---|---|---|
| PhishTank (dump CSV) | Comercial OK (FAQ explícito) | Capa 1 — URLs exactas. Registro de API cerrado hace años: solo el dump. |
| HaGeZi TIF (`wildcard/tif.mini.txt`) | GPL-3.0 — OK server-side | Capa 1 — dominios |
| URLhaus (abuse.ch) | Gratis con Auth-Key; al escalar, cotizar con Spamhaus | Capa 1 — dominios malware (gated por env) |
| Google Web Risk (Lookup API) | Comercial; 100k lookups/mes gratis, luego USD 0,50/1000 | Capa 2 (gated por env). Deduplicar + cachear SIEMPRE. |
| Google Safe Browsing | **PROHIBIDA** (solo no comercial) | — |
| VirusTotal free | **PROHIBIDA en producción** (solo análisis manual interno) | — |
| OpenPhish Community / Phishing Army | **PROHIBIDAS** (no comercial) | — |

Regla del código: PhishTank indexa la URL completa (host+path+query). Nunca indexar la forma sin query de una entrada con query: PhishTank contiene open-redirects sobre dominios legítimos (`google.com/?...&url=evil`) y recortar la query marca todo el dominio como malicioso.

## IA (capa 3b)

- Clasificación de intención con Claude (`claude-opus-5` por defecto, configurable con `LLM_MODEL`), structured outputs vía `messages.parse` + zod.
- Solo se consulta en la franja ambigua de score (control de costo/latencia).
- Tiendas: exige disclosure de "third-party AI" y consentimiento (App Store 5.1.2(i) desde nov-2025). Incluir en el flujo de onboarding antes del submit.

## Privacidad

- Ley 25.326 + políticas de tiendas: no se venden datos, no se arman perfiles.
- Análisis on-device cuando sea posible; al backend solo va la URL a verificar.
- Alertas e historial viven en el dispositivo (AsyncStorage) hasta que existan cuentas.

## Hoja de ruta

| Fase | Alcance | Estado |
|---|---|---|
| 0 | Validación, diseño, trámites (cuenta Apple Organization, Play Console, Web Risk) | En curso |
| 1 | **MVP**: Escáner de Enlaces + Score + Centro de Alertas (iOS/Android) | Este repo |
| 2 | Escudo DNS (DoH + VpnService) + Protección de Mensajes | Pendiente |
| 3 | Escáner del dispositivo + Modo Familia | Pendiente |
| 4 | Monetización (freemium), publicación, marketing | Pendiente |

## Riesgos activos

1. Cuenta Apple individual no puede publicar el escudo DNS → enrolar Organization ya.
2. Acumulación de permisos sensibles (VPN + notificaciones) eleva el escrutinio de revisión → declaraciones + video demos preparados por adelantado.
3. Regresiones de iOS en Message Filter (reportes activos en iOS 26) → QA por versión en dispositivos reales.
4. Costo variable de Web Risk al escalar → deduplicación y caché desde el día 1 (ya implementado).
5. Dependencia de mantenedores individuales (`expo-share-intent`, `expo-apple-targets`) → versiones pinneadas, plan B de config plugins propios.

# Publicación: qué hacer en Apple y en Google

Guía operativa para Nova Solutions SAS. Da por hecho que ya existen las dos cuentas de developer. Verificado contra documentación oficial el 08-08-2026; las consolas cambian seguido, revalidar antes de cada envío.

Orden recomendado: **primero probar en tu propio iPhone** (parte 1), después la parte de tiendas.

---

## Parte 1 · Instalar la app en tu iPhone (no requiere App Store)

No hace falta Mac: EAS compila en la nube. Todo esto se corre desde `apps/mobile`.

### 1.1 Una vez, en tu máquina

```bash
npm install -g eas-cli
eas login                 # cuenta de Expo (gratis)
cd apps/mobile
eas init                  # crea el proyecto y escribe el projectId en app.json
```

### 1.2 Registrar tu iPhone

```bash
eas device:create
```

Elegí "Website / Register a device", abrí el link **desde el iPhone**, instalá el perfil y confirmá. Esto anota el UDID del equipo en tu cuenta de Apple: sin ese paso, el build instala pero no abre.

### 1.3 Compilar

```bash
eas build --profile development --platform ios
```

EAS pide tus credenciales de Apple y crea solo los identificadores, certificados y perfiles. Cuando termina te da un QR: escaneálo desde el iPhone y se instala.

**Lo que EAS necesita crear en tu cuenta de Apple** (lo hace solo si le das acceso, pero conviene saber qué está pasando):

| Qué | Para qué |
|---|---|
| App ID `ar.com.novasolutions.novashield` | La app |
| App IDs de las extensiones (`.DnsShield`, `.MessageFilter`, `.ShareExtension`) | Cada target nativo firma aparte |
| Capability **Network Extensions** | Escudo DNS. Es self-serve, no hay que pedir permiso a Apple |
| Capability **App Groups** (`group.ar.com.novasolutions.novashield`) | La app y el túnel comparten la lista de bloqueo |

> Si EAS falla creando los App Groups, creálos a mano en developer.apple.com → Identifiers → App Groups, con ese identificador exacto, y volvé a correr el build.

### 1.4 Levantar el backend donde el teléfono lo vea

Este es el paso que más se olvida: `localhost` en el celular es el celular, no tu PC.

```bash
# En tu máquina
npm run backend

# Averiguá tu IP de la red WiFi y poné en apps/mobile/.env:
# EXPO_PUBLIC_API_URL=http://192.168.0.10:3000

cd apps/mobile && npx expo start --dev-client
```

Con el build de desarrollo, el JS lo sirve Metro desde tu máquina: cambiás el `.env`, recargás la app y listo — **no hay que recompilar**.

### 1.5 Qué vas a poder probar y qué no

| Función | ¿Anda en tu iPhone? |
|---|---|
| Escáner de enlaces y de mensajes | Sí |
| Score, alertas, escáner del dispositivo | Sí |
| Escudo DNS (packet tunnel) | Sí — iOS te va a pedir permiso de VPN |
| Compartir un link desde WhatsApp | Sí |
| Filtro de SMS (`ILMessageFilterExtension`) | Solo con SMS de números desconocidos, y hay que activarlo a mano en Ajustes → Apps → Mensajes → Filtrado de SMS desconocidos |
| Modo Familia | Sí, si el backend es alcanzable |
| Comprar una suscripción | No hasta configurar RevenueCat + productos en App Store Connect |

**Advertencia honesta**: el código nativo de las fases 2 y 3 nunca corrió en hardware. Este primer build es justamente para descubrir qué se rompe. Es normal que el primer intento falle en la firma de los targets; si pasa, mandame el log de EAS.

---

## Parte 2 · Apple (App Store Connect + Developer)

### 2.1 EL BLOQUEANTE: tipo de cuenta

La guideline **5.4** dice, textual, que las apps que ofrecen servicios de VPN *"may only be offered by developers enrolled as an organization"*. El Escudo DNS usa Network Extension, así que cuenta como VPN a los ojos de App Review.

- **Para probar en tu iPhone**: tu cuenta Individual alcanza. El entitlement es self-serve.
- **Para publicar**: necesitás cuenta **Organization**.

Qué hacer, y cuánto tarda: pedir el **número D-U-N-S** para Nova Solutions SAS en [developer.apple.com/enroll/duns-lookup](https://developer.apple.com/enroll/duns-lookup/) (gratis, entre 5 y 14 días hábiles). Con el D-U-N-S y el CUIT se solicita el cambio a Organization. Apple llama por teléfono a verificar que existís y que tenés autoridad para firmar.

**Empezá este trámite ya**, en paralelo con todo lo demás: es lo único que no podés acelerar y bloquea el lanzamiento en iOS.

### 2.2 Acuerdos y datos fiscales

En App Store Connect → **Business**:

1. Aceptar el **Paid Applications Agreement** (sin esto no se pueden crear suscripciones, ni siquiera para probar).
2. Cargar datos bancarios y fiscales de la SAS.
3. Argentina: revisar la configuración de impuestos y quién retiene.

### 2.3 Crear la app

App Store Connect → **Apps → +**:

- Nombre: `Nova Shield`
- Bundle ID: `ar.com.novasolutions.novashield`
- SKU: `novashield-ios`
- Idioma principal: Español (México o España — no hay variante rioplatense; los textos igual van en rioplatense)

### 2.4 Suscripciones

En la app → **Monetization → Subscriptions**:

1. Crear un **Subscription Group** llamado `Nova Shield` (importante: los dos planes van en el MISMO grupo, así el usuario puede cambiar de Premium a Familia sin pagar dos veces).
2. Crear los productos:

| Product ID | Nombre | Precio de referencia |
|---|---|---|
| `novashield.premium.monthly` | Premium mensual | USD 2,99 |
| `novashield.family.monthly` | Familia mensual | USD 4,99 |

3. Para cada uno: descripción en español, imagen de review y el precio por territorio (Argentina aparte, en pesos).
4. Duración mínima: 7 días (guideline 3.1.2(a)). Mensual cumple.

> **Los Product ID tienen que coincidir exactamente** con los que cargues en RevenueCat.

### 2.5 Privacidad (App Privacy)

App Store Connect → **App Privacy**. Lo que corresponde declarar según lo que la app realmente hace:

| Dato | ¿Se recolecta? | Detalle |
|---|---|---|
| Historial de navegación | **No** | El escudo filtra on-device; el backend nunca recibe dominios |
| Contenido de mensajes | **No** | Solo se analiza si el usuario lo pide, y no se guarda |
| Identificadores | Sí (ID anónimo de RevenueCat) | Vinculado a la compra, no a la identidad |
| Datos de uso | Sí, si agregás analítica | Hoy no hay |
| Datos de salud, ubicación, contactos | **No** | |

También hace falta:
- **Privacy Policy URL** (obligatoria) → `https://novashield.ar/privacidad`
- **Privacy Manifest** (`PrivacyInfo.xcprivacy`): requerido desde 2024. Todavía no está en el repo — pendiente.

### 2.6 Notas para App Review (esto decide si te aprueban)

En el campo **App Review Notes**, escribir en inglés y ser explícito, porque un revisor que no entiende el escudo lo rechaza por 5.4:

> Nova Shield is a consumer anti-scam app for Argentina. The DNS Shield uses NEPacketTunnelProvider to block known scam/phishing domains **locally on the device**. The blocklist is downloaded as a file of truncated SHA-256 hashes; domain matching happens entirely on-device. **No browsing data, DNS queries, or domain names are ever transmitted to our servers or to any third party**, as stated in our privacy policy. The app does not sell, use, or disclose any user data.
>
> Family Mode is opt-in status sharing between adults: each member joins by typing an invite code on their own device and shares only their own protection status (shield on/off, device security score, alert counters). No location, no message content, no browsing data. All members see the same information about each other and can leave at any time. It is not a monitoring or tracking tool.

Adjuntar también un **video demo** mostrando: la pantalla de disclosure del VPN, el flujo de unión voluntaria al Modo Familia y la pantalla que dice qué se comparte.

### 2.7 Otros campos

- **Age Rating**: 4+ (no hay contenido sensible).
- **Categoría**: Utilities (primaria). Alternativa: Productivity.
- **Declaración de VPN**: describir qué datos se recolectan **antes** de que el usuario active el escudo (ya está implementado en la pantalla de Protección).

---

## Parte 3 · Google Play Console

### 3.1 Verificá si te aplica el testeo obligatorio

Si tu cuenta **personal** se creó **después del 13 de noviembre de 2023**, Google exige, antes de dejarte publicar en producción:

- **12 testers** como mínimo,
- opted-in de forma continua durante **14 días**,
- y con **uso real** de la app (desde abril de 2026 rechazan por "insufficient testing engagement" si los testers no la abren).

Si la cuenta es anterior a esa fecha, **o es una cuenta de organización**, estás exento.

> Esto define tu cronograma: si te aplica, sumá al menos 3 semanas antes de poder publicar. Empezá el closed testing apenas tengas un build estable — no esperes a tener todo terminado.

### 3.2 Crear la app

Play Console → **Create app**:

- Nombre: `Nova Shield`
- Idioma por defecto: Español (Latinoamérica)
- App, gratuita (con compras dentro de la app)

### 3.3 Declaraciones obligatorias (acá está el riesgo real)

En **Policy → App content**:

**a) Permisos sensibles.** La app usa `VpnService` y `NotificationListenerService`. Hay que explicar en la declaración de permisos que:
- el VPN es un **filtro de DNS local**, no un túnel de tráfico, y no enruta la navegación del usuario a ningún servidor;
- el acceso a notificaciones se usa para detectar enlaces de estafa **en el dispositivo**, y el contenido no se sube.

**b) Data safety.** Declarar:
- Datos recolectados: identificador anónimo de compra; estado de protección si el usuario usa Modo Familia.
- Datos **no** recolectados: navegación, mensajes, ubicación, contactos.
- Cifrado en tránsito: sí. Borrado a pedido: sí (salir del grupo).
- La guía oficial aclara que lo procesado **solo** en el dispositivo no cuenta como recolección — el escáner y el escudo entran ahí.

**c) Target audience**: declarar **18 y más**. Si declarás grupos con menores caés en los Families Policy Requirements (SDKs certificados, restricciones de datos), que no aportan nada al producto.

**d) NO declarar el flag `isMonitoringTool`.** Es obligatorio solo para "monitoring apps", y esa categoría —según la política de Stalkerware— solo admite padres→hijos o empresa→empleados, y prohíbe explícitamente compartir entre adultos *"even with their knowledge and permission"*. El Modo Familia está diseñado para no ser eso. Ver `docs/decisiones-tecnicas.md`.

**e) Marketing**: nunca usar lenguaje de vigilancia en la ficha ("monitoreá a tu familia", "controlá el teléfono de tus hijos"). Es lo que empujaría a Play a reclasificar la app. El encuadre es *compartir tranquilidad*.

### 3.4 Suscripciones

**Monetize → Products → Subscriptions**. Primero configurá el perfil de pagos (Merchant account) o no vas a poder crear nada.

| Product ID | Base plan | Precio |
|---|---|---|
| `novashield.premium.monthly` | `monthly` | USD 2,99 |
| `novashield.family.monthly` | `monthly` | USD 4,99 |

Play separa "producto" de "base plan": el ID que RevenueCat necesita es el del **producto**, y el base plan se elige adentro.

### 3.5 Ficha de la tienda

- Descripción corta (80 caracteres): *Bloquea estafas y sitios falsos antes de que te hagan daño.*
- Descripción larga: qué hace, y **qué no puede hacer** (ninguna app frena el 100% de las estafas). Esa honestidad es la propuesta de valor y además evita reclamos.
- Capturas: mínimo 2 por tipo de dispositivo.
- Política de privacidad: obligatoria.

---

## Parte 4 · RevenueCat

1. Crear proyecto en [app.revenuecat.com](https://app.revenuecat.com).
2. **Apps → iOS**: bundle ID + subir la clave `.p8` de App Store Connect API (para validar recibos y recibir notificaciones de estado).
3. **Apps → Android**: package name + credenciales de service account de Google Cloud con acceso a Play Developer API.
4. **Entitlements** — los identificadores tienen que ser exactamente estos, porque están en el código (`packages/shared/src/plans.ts`):

| Entitlement | Productos que lo otorgan |
|---|---|
| `premium` | `novashield.premium.monthly` y `novashield.family.monthly` |
| `familia` | `novashield.family.monthly` |

> Que el plan Familia otorgue **los dos** entitlements no es un detalle: si no, quien paga Familia se queda sin el escudo.

5. **Offerings**: una oferta `default` marcada como *current*, con los dos paquetes.
6. Copiar las **public SDK keys** a `EXPO_PUBLIC_RC_IOS_KEY` y `EXPO_PUBLIC_RC_ANDROID_KEY`. Son públicas por diseño (van en el binario); las secretas nunca se ponen en la app.

---

## Parte 5 · Lo que falta antes de poder publicar

Bloqueantes reales, ninguno es de código:

1. **Cuenta Apple Organization** (D-U-N-S). Lo más lento: empezá hoy.
2. **Backend desplegado** con dominio propio y HTTPS. Hoy `apps/backend` corre local. Railway + PostgreSQL, y `FAMILY_DB_SYNC=1` solo en el primer arranque.
3. **Política de privacidad y términos publicados** en `novashield.ar`. Obligatorio en las dos tiendas y para la Ley 25.326.
4. **Registro auditable del consentimiento** del Modo Familia (timestamp + versión del texto aceptado), art. 5 y 6 de la Ley 25.326.
5. **Migraciones de TypeORM** en vez de `synchronize`, antes de tener datos de usuarios reales.
6. **QA en dispositivos reales**, iOS y Android. Nada del código nativo corrió todavía en hardware.
7. **Privacy Manifest** (`PrivacyInfo.xcprivacy`) para iOS.
8. Si te aplica: **12 testers × 14 días** en Play.

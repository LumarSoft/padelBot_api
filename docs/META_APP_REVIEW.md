# Revisión de la app GTP en Meta (Advanced Access)

App: **GTP - Gestiona tu padel** (`1542936483770854`) · Portfolio: **JPMG** (verificado) ·
Config. de registro insertado: `1573430397917832`.

Objetivo: obtener **Advanced Access** a `whatsapp_business_messaging` y
`whatsapp_business_management`. Con eso cada club conecta su propio WhatsApp desde su propio
portfolio (y se habilita coexistence). Meta tarda ~24 h en promedio.

> Pedir **solo estos dos** permisos (más `public_profile`, que viene por defecto). Pedir de más
> es la causa de rechazo más común. `business_management`, `manage_app_solution` y
> `whatsapp_business_manage_events` **no** se piden.

---

## 0. Antes de enviar (checklist)

En developers.facebook.com → GTP → **Configuración de la aplicación → Información básica**:

| Campo | Valor |
| --- | --- |
| URL de la política de privacidad | `https://www.gestionatupadel.com/privacidad` |
| URL de las condiciones del servicio | `https://www.gestionatupadel.com/terminos` |
| Eliminación de datos → Instrucciones (URL) | `https://www.gestionatupadel.com/eliminar-datos` |
| Ícono 1024×1024 | logo GTP (ya cargado) |
| Categoría | Negocios (ya cargada) |
| Plataforma web → URL del sitio (opcional) | `https://www.gestionatupadel.com/` |

Privacidad, condiciones y eliminación de datos ya quedaron cargadas el 2026-10-12 (antes
condiciones y eliminación apuntaban a `facebook.com`, un valor de relleno).

- [ ] Verificación de la empresa JPMG: ✅ (ya está).
- [ ] Webhook `https://api.gestionatupadel.com/webhook` con `messages`, `history`,
      `smb_app_state_sync`, `smb_message_echoes`: ✅.
- [ ] Videos grabados (sección 3) en `.mp4`, uno por permiso, **sin** mezclar casos de uso.

---

## Cómo grabar (los dos videos)

- **Grabador:** en la Mac, `Cmd + Shift + 5` → "Grabar parte de la pantalla" (o pantalla
  completa). Sale un `.mov`; Meta lo acepta (si no, exportalo como `.mp4` desde QuickTime).
- **Duración:** 1–2 minutos cada uno, sin cortes ni música. Meta prefiere ver el flujo real.
- **Idioma:** está bien en español; los textos del formulario van en inglés.
- **Nada sensible en pantalla:** cerrá pestañas con tokens, `.env`, la clave secreta o la
  terminal del VPS antes de grabar.
- **Un video por permiso.** No mezclar los dos casos de uso en el mismo video.

## 1. `whatsapp_business_messaging`

**Cómo usa tu app este permiso** (pegar en inglés):

> GTP is a booking assistant for padel clubs. Each club connects its own WhatsApp Business
> number to GTP through Embedded Signup. We use whatsapp_business_messaging to receive the
> messages that players send to the club's number (via webhooks) and to reply on the club's
> behalf: our assistant shows available courts and times with interactive buttons, creates the
> booking, sends the deposit (bank transfer) instructions, and confirms the booking once the
> payment is received. We also send a pre-approved utility template to remind the player of
> their booking about one hour before it starts. Club staff can read every conversation in the
> GTP web panel and take over any chat manually. Messages are only sent to players who
> contacted the club first or who have an active booking.

**Video (1–2 min), qué mostrar:**

*Preparación:* en la compu, dos ventanas lado a lado: a la izquierda el panel de GTP en
`/panel/conversaciones` (logueado como 360Padel); a la derecha **WhatsApp Web** con tu número
(+54 341 695 6364, que es destinatario del número de prueba). Antes de grabar mandá `/reset` al
bot para arrancar la conversación de cero.

1. Mostrar el panel de GTP (`/panel/conversaciones`) y la URL `www.gestionatupadel.com`.
2. En WhatsApp Web, escribirle **"hola"** al número del club (+1 555-678-0421).
3. Se ve llegar la respuesta del bot en WhatsApp **y** la conversación aparecer en el panel.
4. Reservar un turno con los botones hasta el mensaje de seña (y si se puede, la confirmación).
5. Mostrar en el panel una respuesta manual del staff enviada desde GTP y recibida en WhatsApp.

## 2. `whatsapp_business_management`

**Cómo usa tu app este permiso** (pegar en inglés):

> We use whatsapp_business_management to onboard and operate the WhatsApp Business accounts of
> the padel clubs that sign up for GTP. After a club completes Embedded Signup in our web panel,
> our backend uses this permission to subscribe our app to the club's WABA webhooks, register
> the club's phone number (or sync contacts and chat history when the club keeps using the
> WhatsApp Business app — coexistence), read the phone number's display name and status to show
> them in the club's panel, and manage the message templates the club needs, such as the booking
> reminder template. We only access the WhatsApp Business accounts that clubs explicitly share
> with us through Embedded Signup.

**Video (1–2 min), qué mostrar** (el ejemplo que pide Meta es *crear una plantilla*):

*Preparación:* abrí business.facebook.com → WhatsApp Manager → cuenta **Test WhatsApp Business
Account** (la del número +1 555-678-0421). Cuando el club real tenga su número, la plantilla se
vuelve a crear en SU cuenta.

1. WhatsApp Manager de la cuenta de prueba → **Plantillas de mensajes → Crear plantilla**.
2. Crear la plantilla de recordatorio (sirve además para activar los recordatorios):
   - Categoría: **Utilidad** · Nombre: `recordatorio_turno` · Idioma: **Español (ARG)** `es_AR`
   - Cuerpo:
     `¡Hola {{1}}! Te recordamos tu turno de pádel en {{2}} hoy a las {{3}}. ¡Te esperamos! 🎾`
   - Ejemplos: `Lucas` · `Cancha 1` · `18:00`
3. Enviar y mostrar la plantilla en la lista.
4. (Opcional, suma) Mostrar en el panel de GTP `/setup?step=whatsapp` el botón
   **"Conectar con WhatsApp"** abriendo el popup de Meta, y la línea conectada.

## 3. Instrucciones para el revisor (campo de notas)

> To test: go to https://www.gestionatupadel.com/login and sign in with the test club account
> below. Open "Configuración → Bot" to see the WhatsApp connection (Embedded Signup button) and
> "Conversaciones" to see live WhatsApp chats. To see the assistant reply, send "hola" on
> WhatsApp to +1 555-678-0421 from a number added as a recipient in our test setup (or watch the
> attached screencasts).

Credenciales: crear desde el panel (Configuración → Equipo) un usuario **solo para el
revisor** en un club de prueba (no compartir la cuenta de 360Padel ni contraseñas reales) y
pegarlo en el formulario de Meta. Borrarlo cuando aprueben.

---

## 4. Caso de soporte por coexistence (en paralelo)

Meta Business Help → *WABiz: Onboarding* → *Embedded Signup - Coexistence Onboarding*:

> Our Tech Provider app GTP (App ID 1542936483770854, Embedded Signup configuration
> 1573430397917832, business JPMG 1884502882218996) passes
> extras = {"featureType":"whatsapp_business_app_onboarding","sessionInfoVersion":"3","version":"v4"},
> and we are subscribed to history, smb_app_state_sync and smb_message_echoes. However, the flow
> still shows the standard "create or select your WhatsApp Business account" screen and never
> offers to connect an existing WhatsApp Business app number (also in the Meta-hosted Embedded
> Signup link). What is missing to enable coexistence onboarding for our app?

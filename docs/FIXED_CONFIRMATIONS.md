# Confirmación automática de los turnos fijos

La tarea diaria más pesada de la recepción es llamar a cada turno fijo para preguntar si viene.
Con esto lo hace el bot: le manda a cada fijo un WhatsApp con dos botones, **"Sí, voy"** y
**"No puedo"**, y la recepción solo llama a los que no contestaron.

Código: `src/fixed-confirmations/` (`FixedConfirmationsService`). Endpoints en `docs/endpoints.md`
(`PATCH /bookings/:id/attendance`, `GET`/`PATCH /clubs/me/fixed-confirmation`).

## Cómo funciona

1. **Pregunta.** `Club.fixedConfirmationLeadHours` horas antes de cada turno fijo (default **24**:
   el día anterior, a la misma hora del turno), un cron cada 5 minutos le manda al jugador la
   plantilla de Meta. Cada botón lleva un payload con el turno: `FIJO:YES:<bookingId>` /
   `FIJO:NO:<bookingId>`. Se elige **anticipación en horas** (y no "una hora fija del día") porque
   es un solo número fácil de explicar ("te escribimos el día anterior a la misma hora") y, al caer
   siempre dentro del horario del club, nunca manda mensajes a la madrugada. Opciones del panel:
   3, 6, 12, 24 o 48 horas.
   - Solo se marca `Booking.attendanceAskedAt` si Meta aceptó el mensaje. Si falla (plantilla sin
     aprobar, número mal cargado) no se reintenta en loop: el turno queda "sin preguntar" y le
     llega el recordatorio de 1h de siempre.
   - Mismo patrón de "balde" que el recordatorio: cada turno cae en un único barrido de 5 minutos.
     Un fijo creado (o una función activada) cuando ya faltan menos horas que la anticipación no
     se pregunta: queda con el recordatorio de 1h y la recepción lo ve en "Fijos sin respuesta".
2. **Respuesta** (`message.type === 'button'` en el webhook, dentro de la cola serial del
   remitente). Antes de hacer nada se valida que el turno sea **del club de la línea** que recibió
   el toque y **del número que tocó** (comparando el teléfono cargado a mano con el wa_id).
   - **"Sí, voy"** → `attendanceConfirmed = true` y el bot agradece.
   - **"No puedo"** → se cancela **solo esa fecha** (`BookingsService.cancel` con
     `attendanceDeclined`); el `RecurringBooking` sigue igual las semanas siguientes y la cancha
     liberada dispara la lista de espera como cualquier otra. El bot confirma y el staff recibe un
     push.
   - Es idempotente: tocar dos veces responde lo mismo y no vuelve a escribir ni a liberar. "No
     puedo" después de "Sí, voy" libera (cambiar de planes temprano le sirve al club); "Sí, voy"
     después de "No puedo" no recupera la cancha (puede ser de otro) y le pide que escriba.
   - La respuesta sale aunque el chat esté en modo HUMANO: es el comprobante de algo que hizo el
     jugador, como una confirmación de pago. El intercambio queda en Conversaciones.
3. **Sin respuesta.** **Nunca se cancela automáticamente.** 2 horas antes del turno
   (`FIXED_CONFIRMATION_ALERT_MINUTES`, default 120) el staff recibe un push con a quién llamar;
   en la Agenda del panel aparece en "Fijos sin respuesta" con el teléfono.

### Convivencia con el recordatorio de 1h

Un jugador recibe **una sola plantilla por turno**: si al fijo ya se le preguntó
(`attendanceAskedAt` no nulo), `BookingRemindersService` no le manda el recordatorio de 1h. Si la
pregunta no se pudo enviar, el recordatorio sale como siempre. Con la función apagada, todo sigue
como antes.

## Variables de entorno

```bash
WHATSAPP_FIXED_CONFIRMATION_TEMPLATE_NAME="confirmacion_turno_fijo"  # nombre exacto de la plantilla aprobada
WHATSAPP_FIXED_CONFIRMATION_TEMPLATE_LANG="es_AR"                    # idioma en que se aprobó
FIXED_CONFIRMATION_ALERT_MINUTES=120                                  # aviso al staff si no respondió
```

## Plantilla para enviar a aprobación de Meta

Crear en el WhatsApp Manager **de cada número de club** (igual que `recordatorio_turno`):

- **Categoría:** Utilidad (Utility)
- **Nombre:** `confirmacion_turno_fijo`
- **Idioma:** Español (ARG) — `es_AR`
- **Encabezado:** ninguno
- **Cuerpo:**

  ```text
  Hola {{1}} 👋 Tenés tu turno fijo {{2}} a las {{3}} en {{4}}. ¿Venís?

  Tocá una opción así el club sabe si te espera o si libera la cancha.
  ```

- **Pie de página:** `Si no podés, solo se libera esa fecha. Tu fijo sigue.`
- **Botones:** dos de **respuesta rápida** (Quick reply), en este orden:
  1. `Sí, voy`
  2. `No puedo`
- **Ejemplos de variables:** `{{1}}` = `Juan Pérez` · `{{2}}` = `mañana` · `{{3}}` = `19:00` ·
  `{{4}}` = `Cancha 1`

Notas para que la aprueben:

- El cuerpo no empieza ni termina con una variable (Meta lo rechaza).
- `{{2}}` toma los valores `hoy`, `mañana` o `el jueves 16/10`, así la frase siempre se lee bien.
- El orden de los botones importa: el código manda el payload de "Sí" en el índice 0 y el de "No"
  en el índice 1.
- Es Utilidad porque es sobre una reserva concreta que el jugador ya tiene, sin nada promocional.

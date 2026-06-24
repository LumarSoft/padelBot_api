import { AvailableDate } from '../availability/availability.service'
import { dayLabelFromKey, dayMonthFromKey, formatDayMonth, formatTimeRange } from '../availability/lib/datetime'
import { BookingOption, CourtOption, SessionContext, SlotOption } from './types'

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtDate(dateKey: string): string {
  return dayMonthFromKey(dateKey)
}

function fmtPrice(cents: number): string {
  if (cents === 0) return 'sin precio'
  return `$${(cents / 100).toLocaleString('es-AR')}`
}

/** Like fmtPrice but always shows the two centavos digits — the transfer must be exact. */
function fmtExact(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Static strings ──────────────────────────────────────────────────────────

export const MENU =
  '¿Qué querés hacer?\n\n' +
  '1️⃣ Reservar un turno\n' +
  '2️⃣ Ver o cancelar mis reservas\n' +
  '3️⃣ Hablar con un asesor\n\n' +
  'Respondé con el número, o escribime con tus palabras (ej: *"un turno el sábado a la tarde"*).'

export const WELCOME = `👋 ¡Hola! Soy el asistente del club 🎾\n\n${MENU}`

export const ADVISOR_HANDOFF =
  '🙌 Dale, te derivo con un asesor del club. En un ratito te escriben por acá. ' +
  'Dejá tu consulta (un torneo, una duda, lo que necesites) y la van a ver. 🎾'
export const BAD_OPTION = `Mmm, no entendí esa opción 🤔\n\n${MENU}`
export const ASK_DATE = `📅 ¿Para qué día lo querés? Decime la fecha (ej: *25/06*) o algo como *"mañana"* o *"el sábado"*.`
export const BAD_DATE = `No me quedó clara la fecha 🤔 Probá con el día y mes (ej: *25/06*) o algo como *"el sábado"*.`
export const ASK_NAME = `👤 ¡Genial! ¿A nombre de quién pongo la reserva?`
export const ASK_DNI = `🪪 Para confirmar el pago necesito tu *DNI* (solo los números). Tiene que ser el del titular que va a transferir la seña.`
export const BAD_DNI = `Mmm, ese DNI no me cierra 🤔 Pasámelo solo con números (7 u 8 dígitos), sin puntos.`
export const BAD_SLOT = `Ese número de turno no está en la lista 🤔 Elegí uno de los de arriba.`
export const BAD_COURT = `Ese número de cancha no está en la lista 🤔 Elegí una de las de arriba.`
export const BAD_BOOKING = `Ese número no está en la lista 🤔 Elegí uno, o escribí *0* para volver.`
export const NO_SLOTS = `😕 Justo en esa cancha no me quedan turnos para ese día. Decime otra fecha y la chequeo. 🎾`
export const NO_BOOKINGS = `📭 No te encuentro reservas confirmadas por ahora.\n\n${MENU}`
export const BOOKING_ABORTED = `Listo, no reservé nada 👍 Cuando quieras lo vemos.\n\n${MENU}`
export const BOOKING_FAILED = `😕 Uy, no pude confirmar la reserva — puede que alguien haya tomado ese turno justo recién. Probemos con otro.\n\n${MENU}`
export const CANCEL_CONFIRMED = `✅ Listo, cancelé tu reserva. ¡Cualquier cosa avisame!`
export const CANCEL_FAILED = `😕 No pude cancelar la reserva. Probá de nuevo en un ratito o escribime.\n\n${MENU}`
export const CANCEL_ABORTED = `Perfecto, dejé tu reserva como estaba 👍`
export const PAYMENT_UNAVAILABLE = `😅 Justo no puedo tomar el pago por acá en este momento. Escribile al club así te ayudan a confirmar la reserva. 🎾`
export const PAYMENT_CLAIM_NO_PENDING = `Mmm, no me figura ninguna reserva tuya esperando pago 🤔. Si transferiste recién, dame un par de minutos y revisá; si no, escribime *reservar* y armamos el turno. 🎾`
export const ATTACHMENT_NO_PENDING = `Recibí tu archivo 🙌 pero por acá no puedo abrir imágenes. Si transferiste para una reserva, esperá un toque y te confirmo solo; si necesitás otra cosa, escribime con palabras. 🎾`

// ── Dynamic builders ────────────────────────────────────────────────────────

export function noCourts(date: string): string {
  return `😕 No hay turnos disponibles para el ${fmtDate(date)}. ¿Querés probar con otra fecha?`
}

/**
 * Shown when the requested date has no availability. Instead of dead-ending, it
 * proactively offers the nearest days that DO have free slots — the way a person
 * at the front desk would.
 */
export function noAvailabilityWithSuggestions(dateKey: string, suggestions: AvailableDate[]): string {
  if (suggestions.length === 0) {
    return (
      `😕 Para el *${dayLabelFromKey(dateKey)}* no me queda ningún turno libre, ` +
      `y tampoco veo lugar en los próximos días.\n\n` +
      `Escribime otra fecha y la chequeo, o probá más adelante. 🎾`
    )
  }
  const list = suggestions
    .map(s => `• *${dayLabelFromKey(s.dateKey)}* — ${s.count} ${s.count === 1 ? 'turno libre' : 'turnos libres'}`)
    .join('\n')
  return (
    `😕 Para el *${dayLabelFromKey(dateKey)}* no me queda ningún turno libre.\n\n` +
    `Pero sí tengo lugar acá:\n${list}\n\n` +
    `¿Te muestro alguno? Decime la fecha o el día. 🎾`
  )
}

export function courtsList(courts: CourtOption[], date: string): string {
  const list = courts.map(c => `• ${c.name}`).join('\n')
  return `🎾 Para el *${fmtDate(date)}* tengo estas canchas con lugar:\n\n${list}\n\nDecime cuál preferís.`
}

/**
 * Shown when the player gave a date + time but no court: lists the courts that are
 * free at exactly that time so they just pick one (and we already know the slot).
 */
export function courtsAtTimeList(courts: CourtOption[], timeLabel: string, date: string): string {
  const list = courts.map(c => `• ${c.name}`).join('\n')
  return (
    `🎾 Para el *${fmtDate(date)}* a las *${timeLabel}* tengo libre:\n\n${list}\n\n` +
    `Decime en cuál te la reservo.`
  )
}

export function slotsList(slots: SlotOption[], courtName: string, date: string): string {
  const list = slots.map(s => `• ${s.label} — ${fmtPrice(s.price)}`).join('\n')
  return `⏰ Estos son los horarios libres en *${courtName}* el *${fmtDate(date)}*:\n\n${list}\n\nDecime cuál te queda bien (ej: *las 18*).`
}

export function confirmBooking(ctx: SessionContext): string {
  return (
    `📋 *Resumen de tu reserva:*\n\n` +
    `📅 Fecha: ${fmtDate(ctx.selectedDate!)}\n` +
    `🎾 Cancha: ${ctx.selectedCourtName}\n` +
    `⏰ Horario: ${ctx.selectedSlotLabel}\n` +
    `💰 Precio: ${fmtPrice(ctx.selectedSlotPrice!)}\n` +
    `👤 Nombre: ${ctx.playerName}\n\n` +
    `👀 Revisá que esté todo bien. Si coincide, confirmame y te lo dejo reservado 🎾`
  )
}

export function bookingConfirmed(ctx: SessionContext): string {
  return (
    `✅ *¡Reserva confirmada!*\n\n` +
    `📅 ${fmtDate(ctx.selectedDate!)} · ${ctx.selectedSlotLabel}\n` +
    `🎾 ${ctx.selectedCourtName}\n\n` +
    `¡Nos vemos en la cancha! 🎾`
  )
}

export function myBookingsList(options: BookingOption[]): string {
  const list = options.map(o => `• ${o.label}`).join('\n')
  return `📋 *Tus reservas confirmadas:*\n\n${list}\n\n${MENU}`
}

export function cancelList(options: BookingOption[]): string {
  // Numbered on purpose: cancelling is destructive, so a precise pick beats
  // free-text matching here.
  const list = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
  return `❌ ¿Cuál reserva querés cancelar?\n\n${list}\n\nDecime el número, o *0* para volver.`
}

export function confirmCancel(label: string): string {
  return `Me estás pidiendo cancelar la reserva *${label}*. ¿Te la doy de baja? Confirmame y la cancelo, o avisame si preferís dejarla.`
}

export function transferPending(
  ctx: SessionContext,
  transfer: { alias: string; holder: string | null },
  transferAmountCents: number,
  depositMode: 'DEPOSIT' | 'FULL' = 'DEPOSIT',
  requireDni = false,
): string {
  const holderLine = transfer.holder ? `\n👤 Titular: *${transfer.holder}*` : ''
  const whatToPay =
    depositMode === 'FULL' ? 'transferí el total de la cancha' : 'transferí la seña para reservar'

  // In DNI mode the amount is round and identity is validated by the payer's DNI, so we
  // don't ask for exact centavos — we ask them to pay from their OWN account.
  const guard = requireDni
    ? `⚠️ Importante: transferí *desde tu propia cuenta* de MercadoPago` +
      (ctx.playerDni ? ` (a nombre del DNI *${ctx.playerDni}*)` : '') +
      `. Así confirmo tu pago solo; si transferís desde otra cuenta, lo reviso a mano.`
    : `⚠️ Transferí el monto *exacto, con los centavos* — así reconozco tu pago al instante y te confirmo solo. ` +
      `Si transferís otro importe, no voy a poder asociarlo automáticamente.`

  return (
    `⏳ *Reserva pre-confirmada — falta el pago*\n\n` +
    `📅 ${fmtDate(ctx.selectedDate!)} · ${ctx.selectedSlotLabel}\n` +
    `🎾 ${ctx.selectedCourtName}\n\n` +
    `Para confirmar el turno, ${whatToPay}:\n\n` +
    `💰 Importe: *${fmtExact(transferAmountCents)}*\n` +
    `🏦 Alias: *${transfer.alias}*${holderLine}\n\n` +
    `${guard}\n\n` +
    `⏰ Tenés *30 minutos*. Cuando se acredite te aviso por acá; si no llega a tiempo, el turno queda libre.`
  )
}

/**
 * Reassurance when the player says they already transferred (or sends a receipt
 * image). We never confirm from a screenshot — the poller confirms the real money —
 * so we just acknowledge and tell them it's coming.
 */
export function paymentClaimAck(
  courtName: string,
  startsAt: Date,
  endsAt: Date,
  transferAmountCents: number | null,
): string {
  const amountLine = transferAmountCents != null ? ` de *${fmtExact(transferAmountCents)}*` : ''
  return (
    `¡Gracias! 🙌 Tu transferencia${amountLine} me llega sola — no hace falta que mandes el comprobante.\n\n` +
    `Apenas se acredite (suele ser un par de minutos) te confirmo *${courtName} · ${formatDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}* por acá. 🎾`
  )
}

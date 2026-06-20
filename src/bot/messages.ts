import { BookingOption, CourtOption, SessionContext, SlotOption } from './types'

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function fmtPrice(cents: number): string {
  if (cents === 0) return 'sin precio'
  return `$${(cents / 100).toLocaleString('es-AR')}`
}

// ── Static strings ──────────────────────────────────────────────────────────

export const MENU =
  '¿Qué querés hacer?\n\n' +
  '1️⃣ Reservar un turno\n' +
  '2️⃣ Ver mis reservas\n' +
  '3️⃣ Cancelar una reserva\n\n' +
  'Respondé con el número.'

export const WELCOME = `👋 ¡Bienvenido al sistema de reservas!\n\n${MENU}`
export const BAD_OPTION = `❌ Opción no válida.\n\n${MENU}`
export const ASK_DATE = `📅 ¿Para qué fecha querés reservar?\nEscribí el día y mes (ej: *25/06*)`
export const BAD_DATE = `❌ Fecha no válida. Escribí el día y mes (ej: *25/06*)`
export const ASK_NAME = `👤 ¿Cómo te llamás? (escribí tu nombre completo)`
export const BAD_SLOT = `❌ Número de turno no válido. Elegí un número de la lista.`
export const BAD_COURT = `❌ Número de cancha no válido. Elegí un número de la lista.`
export const BAD_BOOKING = `❌ Número no válido. Elegí un número de la lista o escribí *0* para volver.`
export const NO_SLOTS = `😕 No quedan turnos disponibles en esa cancha para la fecha seleccionada.\n\n${MENU}`
export const NO_BOOKINGS = `📭 No tenés reservas confirmadas.\n\n${MENU}`
export const BOOKING_ABORTED = `👍 Reserva cancelada.\n\n${MENU}`
export const BOOKING_FAILED = `❌ No se pudo confirmar la reserva. El turno puede ya no estar disponible.\n\n${MENU}`
export const CANCEL_CONFIRMED = `✅ Reserva cancelada correctamente.\n\n${MENU}`
export const CANCEL_FAILED = `❌ No se pudo cancelar la reserva.\n\n${MENU}`
export const CANCEL_ABORTED = `👍 Cancelación abortada.\n\n${MENU}`

// ── Dynamic builders ────────────────────────────────────────────────────────

export function noCourts(date: string): string {
  return `😕 No hay canchas disponibles para el ${fmtDate(date)}.\n\n${MENU}`
}

export function courtsList(courts: CourtOption[], date: string): string {
  const list = courts.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
  return `🎾 Canchas disponibles para el *${fmtDate(date)}*:\n\n${list}\n\nRespondé con el número de la cancha.`
}

export function slotsList(slots: SlotOption[], courtName: string, date: string): string {
  const list = slots.map((s, i) => `${i + 1}. ${s.label} (${fmtPrice(s.price)})`).join('\n')
  return `⏰ Turnos en *${courtName}* el *${fmtDate(date)}*:\n\n${list}\n\nRespondé con el número del turno.`
}

export function confirmBooking(ctx: SessionContext): string {
  return (
    `📋 *Resumen de tu reserva:*\n\n` +
    `📅 Fecha: ${fmtDate(ctx.selectedDate!)}\n` +
    `🎾 Cancha: ${ctx.selectedCourtName}\n` +
    `⏰ Horario: ${ctx.selectedSlotLabel}\n` +
    `💰 Precio: ${fmtPrice(ctx.selectedSlotPrice!)}\n` +
    `👤 Nombre: ${ctx.playerName}\n\n` +
    `¿Confirmás? Respondé *S* para confirmar o *N* para cancelar.`
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
  const list = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
  return `📋 *Tus reservas confirmadas:*\n\n${list}\n\n${MENU}`
}

export function cancelList(options: BookingOption[]): string {
  const list = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')
  return `❌ ¿Cuál reserva querés cancelar?\n\n${list}\n\nRespondé con el número, o *0* para volver.`
}

export function confirmCancel(label: string): string {
  return `¿Cancelás la reserva *${label}*?\n\nRespondé *S* para confirmar o *N* para volver.`
}

import { AvailableDate } from '../availability/availability.service'
import { dayLabelFromKey, dayMonthFromKey, formatDayMonth, formatTimeRange } from '../availability/lib/datetime'
import { BandOption, BotReply, BotState, MyBookingOption, SessionContext, SlotOption } from './types'
import { buildInteractive } from './lib/interactive'

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
  '2️⃣ Ver mis turnos (o cambiar uno de horario)\n\n' +
  'Respondé con el número, o escribime con tus palabras (ej: *"un turno el sábado a la tarde"*).'

/**
 * Greeting + menu. Personalized when we already know the player's name, so a returning
 * "hola" is answered with a warm, predefined message — no LLM call needed.
 */
export function welcome(name?: string): string {
  const hi = name ? `👋 ¡Hola de nuevo, ${name}! 🎾` : `👋 ¡Hola! Soy *GTP*, el asistente del club 🎾`
  return `${hi}\n\n${MENU}`
}

/** Predefined acknowledgement for a "gracias", so we don't spend an LLM call on it. */
export function thanksReply(name?: string): string {
  const hi = name ? `¡De nada, ${name}! 🎾` : '¡De nada! 🎾'
  return `${hi} Si necesitás algo más, acá estoy.\n\n${MENU}`
}

export const ASK_DATE = `📅 ¿Para qué día lo querés? Tocá una opción, o decime la fecha (ej: *25/06*).`
export const ASK_NAME = `👤 ¡Genial! ¿A nombre de quién pongo la reserva?`
export const ASK_DNI = `🪪 Para confirmar el pago necesito tu *DNI* (solo los números). Tiene que ser el del titular que va a transferir la seña.`
export const BAD_DNI = `Mmm, ese DNI no me cierra 🤔 Pasámelo solo con números (7 u 8 dígitos), sin puntos.`
export const BOOKING_ABORTED = `Listo, no reservé nada 👍 Cuando quieras lo vemos.\n\n${MENU}`
/** The LLM couldn't make sense of the message — said above the current step's prompt. */
export const NOT_UNDERSTOOD = `Perdón, no te entendí bien 🤔`
/** Per-user LLM budget exhausted (a burst of messages) — said above the current step's prompt. */
export const TOO_MANY_MESSAGES = `Uy, me llegaron varios mensajes juntos 😅 Vamos de a uno.`
/** The date we understood is unusable (past, or absurdly far away) — re-ask instead of guessing. */
export const DATE_OUT_OF_RANGE = `Mmm, esa fecha no me sirve 🤔 Solo puedo reservar de hoy en adelante.`
export const BOOKING_FAILED = `😕 Uy, no pude confirmar la reserva — puede que alguien haya tomado ese turno justo recién. Probemos con otro.\n\n${MENU}`
export const PAYMENT_UNAVAILABLE = `😅 Justo no puedo tomar el pago por acá en este momento. Escribile al club así te ayudan a confirmar la reserva. 🎾`
export const PAYMENT_CLAIM_NO_PENDING = `Mmm, no me figura ninguna reserva tuya esperando pago 🤔. Si transferiste recién, dame un par de minutos y revisá; si no, escribime *reservar* y armamos el turno. 🎾`
export const ATTACHMENT_NO_PENDING = `Recibí tu archivo 🙌 pero por acá no puedo abrir imágenes. Si transferiste para una reserva, esperá un toque y te confirmo solo; si necesitás otra cosa, escribime con palabras. 🎾`
/** RECEIPT mode: we got an image but the player has no pending booking to attach it to. */
export const RECEIPT_ATTACHMENT_NO_PENDING = `Recibí tu imagen 🙌 pero no me figura ninguna reserva tuya esperando pago. Si querés reservar, escribime *reservar* y lo armamos. 🎾`
/** RECEIPT mode: we couldn't download/store the receipt image. */
export const RECEIPT_ATTACHMENT_FAILED = `Uy, no pude guardar tu comprobante 😅. ¿Me lo reenviás como *foto* (imagen), por favor? Si sigue sin andar, escribile al club y lo confirman. 🎾`
/** RECEIPT mode: player says they paid via text — we need the actual photo. */
export const RECEIPT_CLAIM_ASK_PHOTO = `¡Genial! 🙌 Para confirmar tu reserva necesito que me mandes una *foto del comprobante* de la transferencia por acá. Apenas la reciba, el club la verifica y te confirmo el turno. 🎾`
/** Friendly catch-all when something fails internally, so the bot is never left "en visto". */
export const TECHNICAL_ERROR = `😅 Uy, tuvimos un inconveniente técnico de mi lado. Probá de nuevo en un ratito, por favor. Si sigue sin andar, escribile al club y te ayudan. 🎾`

// ── Dynamic builders ────────────────────────────────────────────────────────

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
      `Escribime otra fecha y la chequeo. Y si querés, respondé *avisame* y te escribo ` +
      `apenas se libere un turno ese día. 🔔`
    )
  }
  const list = suggestions
    .map(s => `• *${dayLabelFromKey(s.dateKey)}* — ${s.count} ${s.count === 1 ? 'turno libre' : 'turnos libres'}`)
    .join('\n')
  return (
    `😕 Para el *${dayLabelFromKey(dateKey)}* no me queda ningún turno libre.\n\n` +
    `Pero sí tengo lugar acá:\n${list}\n\n` +
    `¿Te muestro alguno? Decime la fecha o el día. 🎾\n\n` +
    `💡 O respondé *avisame* y te escribo apenas se libere algo el ${dayLabelFromKey(dateKey)}.`
  )
}

/**
 * The day's availability, grouped by court so the player sees every court with its free times
 * at a glance. They reply with a time (no need to pick a court first) and the bot assigns one.
 */
export function dayAvailabilityList(bands: BandOption[], date: string): string {
  // Invert band→courts into court→times, preserving the time order (bands are already sorted).
  const byCourt = new Map<string, { name: string; times: string[] }>()
  for (const band of bands) {
    for (const c of band.courts) {
      const entry = byCourt.get(c.id) ?? { name: c.name, times: [] }
      entry.times.push(band.label)
      byCourt.set(c.id, entry)
    }
  }
  const groups = [...byCourt.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(g => `*${g.name}*\n${g.times.map(t => `• ${t}`).join('\n')}`)
    .join('\n\n')
  return (
    `🎾 Para el *${fmtDate(date)}* tengo estos turnos libres:\n\n${groups}\n\n` +
    `Decime el horario que querés (ej: *las 18*) y te asigno la cancha. 🎾`
  )
}

/** Like dayAvailabilityList but framed as "that time isn't free, here's what is". */
export function timeNotAvailable(bands: BandOption[], date: string): string {
  return `😕 Para esa hora no me queda lugar.\n\n${dayAvailabilityList(bands, date)}`
}

/**
 * Shown when the player's chosen time is free on more than one court: lists those courts with
 * their price so they pick one — or reply "cualquiera" and the bot assigns the cheapest.
 */
export function courtsAtTimeList(courts: { name: string; price: number }[], timeLabel: string, date: string): string {
  const list = courts.map(c => `• ${c.name} — ${fmtPrice(c.price)}`).join('\n')
  return (
    `🎾 Para el *${fmtDate(date)}* a las *${timeLabel}* tengo libre:\n\n${list}\n\n` +
    `¿Cuál preferís? O decime *"cualquiera"* y te asigno una. 🎾`
  )
}

export function slotsList(slots: SlotOption[], courtName: string, date: string): string {
  const list = slots.map(s => `• ${s.label} — ${fmtPrice(s.price)}`).join('\n')
  return `⏰ Estos son los horarios libres en *${courtName}* el *${fmtDate(date)}*:\n\n${list}\n\nDecime cuál te queda bien (ej: *las 18*).`
}

/**
 * The player asked for a specific court that has no free turns that day. We say so plainly (we
 * don't silently switch courts) and then show what IS free across the club.
 */
export function courtFullToday(courtName: string, bands: BandOption[], date: string): string {
  return `😕 *${courtName}* no tiene turnos libres para el *${fmtDate(date)}*.\n\n${dayAvailabilityList(bands, date)}`
}

/**
 * The player asked for a specific court at a time that's already taken there. We tell them that
 * court is busy at that time (instead of assuming another court) and show its other free turns.
 */
export function courtBusyAtTime(courtName: string, slots: SlotOption[], date: string): string {
  return `😕 En *${courtName}* esa hora ya está ocupada.\n\n${slotsList(slots, courtName, date)}`
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

// ── Mis turnos / reprogramación ─────────────────────────────────────────────
// The bot MOVES bookings, it never cancels them. Rescheduling keeps the deposit alive on the
// same booking, frees the old court for the waitlist to resell, and takes no money out of the
// club — so the player can do it alone. A real cancellation moves money and stays with the club.

export const NO_UPCOMING_BOOKINGS =
  `No te veo ningún turno reservado por acá 🤔\n\n` + `¿Querés reservar uno? Decime *reservar* y lo armamos. 🎾`

/** The player's upcoming bookings. The botonera carries the same list as tappable rows. */
export function myBookingsList(bookings: MyBookingOption[]): string {
  const list = bookings.map(b => `• ${b.label}${b.pending ? ' _(falta la seña)_' : ''}`).join('\n')
  return `🗓️ *Tus próximos turnos:*\n\n${list}\n\n¿Necesitás mover alguno? Elegilo de la lista. 🎾`
}

/** The player picked a booking they can move themselves → ask for the new day. */
export function askRescheduleDate(label: string): string {
  return (
    `🔄 Vamos a mover este turno:\n\n🎾 ${label}\n\n` +
    `No lo cancelo: te lo paso a otro horario y *la seña que pagaste sigue valiendo*. ` +
    `¿Para qué día lo querés?`
  )
}

/** The club doesn't let players move bookings from WhatsApp — staff is notified to handle it here. */
export const RESCHEDULE_OFF = `Los cambios y cancelaciones de turnos los maneja el club directamente 🙏\n\n📩 Ya les avisé de tu mensaje — te responden por acá en un rato. 🎾`

/**
 * The move needs a human: club policy, too close to the start, or the player already used
 * their moves. Never a dead end — the club is told and answers on this same chat.
 */
export function rescheduleRequested(reason: 'club-policy' | 'too-late' | 'limit-reached'): string {
  const why =
    reason === 'too-late'
      ? `Como falta poco para el turno, lo tiene que ver alguien del club.`
      : reason === 'limit-reached'
        ? `Ya moviste este turno una vez, así que lo tiene que ver alguien del club.`
        : `Los cambios de turno los maneja el club directamente.`
  return `${why}\n\n📩 Ya les pasé tu pedido — te responden por acá en un rato. 🎾`
}

/** The player can't make ANY other day — don't trap them in the flow; hand it to the club. */
export const RESCHEDULE_NO_DAY_WORKS = `Entiendo 🙏 Le paso tu caso al club así lo ven ellos y te responden por acá. 🎾`

/** The move summary, with the price difference stated BEFORE the player commits to it. */
export function rescheduleConfirm(oldLabel: string, ctx: SessionContext, priceDiffCents: number): string {
  const head =
    `🔄 *¿Confirmo el cambio?*\n\n` +
    `Antes: ${oldLabel}\n` +
    `Ahora: ${fmtDate(ctx.selectedDate!)} · ${ctx.selectedSlotLabel} · ${ctx.selectedCourtName}\n\n`

  if (priceDiffCents > 0) {
    return (
      `${head}Ese horario sale ${fmtPrice(ctx.selectedSlotPrice!)}, o sea *${fmtPrice(priceDiffCents)} más* ` +
      `que el que tenías. Tu seña sigue aplicada y la diferencia la abonás en el club. ¿Lo muevo?`
    )
  }
  if (priceDiffCents < 0) {
    return `${head}Ese horario sale ${fmtPrice(ctx.selectedSlotPrice!)} — te queda más barato. Tu seña sigue aplicada. ¿Lo muevo?`
  }
  return `${head}Mismo precio y tu seña sigue aplicada. ¿Lo muevo?`
}

export function rescheduleDone(ctx: SessionContext, priceDiffCents: number): string {
  const diff =
    priceDiffCents > 0
      ? `\n\n💰 La diferencia de *${fmtPrice(priceDiffCents)}* la abonás en el club.`
      : priceDiffCents < 0
        ? `\n\n💰 Te queda a favor la diferencia — lo hablás en el mostrador.`
        : ''
  return (
    `✅ *¡Listo, lo moví!*\n\n` +
    `📅 ${fmtDate(ctx.selectedDate!)} · ${ctx.selectedSlotLabel}\n🎾 ${ctx.selectedCourtName}${diff}\n\n` +
    `¡Nos vemos en la cancha! 🎾`
  )
}

export const RESCHEDULE_ABORTED = `👍 Perfecto, te dejé el turno como estaba.\n\n${MENU}`
/** The target band was taken (or the booking changed) between choosing and confirming. */
export const RESCHEDULE_FAILED = `😕 No pude mover el turno — puede que alguien haya tomado ese horario justo recién. Probemos con otro.`

export function transferPending(
  ctx: SessionContext,
  transfer: { alias: string; holder: string | null },
  transferAmountCents: number,
  depositMode: 'DEPOSIT' | 'FULL' = 'DEPOSIT',
  requireDni = false,
  verificationMode: 'AUTO' | 'RECEIPT' = 'AUTO',
): string {
  const holderLine = transfer.holder ? `\n👤 Titular: *${transfer.holder}*` : ''
  const whatToPay = depositMode === 'FULL' ? 'transferí el total de la cancha' : 'transferí la seña para reservar'

  // RECEIPT mode: an admin verifies the receipt photo, so the amount is round and the player
  // must SEND the receipt. No centavos / own-account guard applies here.
  if (verificationMode === 'RECEIPT') {
    return (
      `⏳ *Reserva pre-confirmada — falta el pago*\n\n` +
      `📅 ${fmtDate(ctx.selectedDate!)} · ${ctx.selectedSlotLabel}\n` +
      `🎾 ${ctx.selectedCourtName}\n\n` +
      `Para confirmar el turno, ${whatToPay}:\n\n` +
      `💰 Importe: *${fmtPrice(transferAmountCents)}*\n` +
      `🏦 Alias: *${transfer.alias}*${holderLine}\n\n` +
      `📸 *Importante:* cuando transfieras, mandame una *foto del comprobante* por acá. ` +
      `El club la verifica y te confirmo la reserva.\n\n` +
      `⏰ Tenés *30 minutos* para enviar el comprobante; si no llega a tiempo, el turno queda libre.`
    )
  }

  // In DNI mode the amount is round and identity is validated by the payer's DNI, so we
  // don't ask for exact centavos — we ask them to pay from their OWN account.
  const guard = requireDni
    ? `⚠️ Importante: transferí *desde tu propia cuenta* de MercadoPago` +
      (ctx.playerDni ? ` (a nombre del DNI *${ctx.playerDni}*)` : '') +
      `. Así confirmo tu pago solo; si transferís desde otra cuenta, lo reviso a mano.`
    : `⚠️ Transferí el monto *exacto, con los centavos* — así reconozco tu pago al instante y te confirmo solo. ` +
      `Si transferís otro importe, no voy a poder asociarlo automáticamente.`

  // In DNI mode the amount is a clean round number → show it without the ",00".
  const amount = requireDni ? fmtPrice(transferAmountCents) : fmtExact(transferAmountCents)

  return (
    `⏳ *Reserva pre-confirmada — falta el pago*\n\n` +
    `📅 ${fmtDate(ctx.selectedDate!)} · ${ctx.selectedSlotLabel}\n` +
    `🎾 ${ctx.selectedCourtName}\n\n` +
    `Para confirmar el turno, ${whatToPay}:\n\n` +
    `💰 Importe: *${amount}*\n` +
    `🏦 Alias: *${transfer.alias}*${holderLine}\n\n` +
    `${guard}\n\n` +
    `⏰ Tenés *30 minutos*. Cuando se acredite te aviso por acá; si no llega a tiempo, el turno queda libre.`
  )
}

/**
 * RECEIPT mode acknowledgement: the player sent the receipt photo and we stored it. We never
 * auto-confirm — an admin verifies the image — so we tell them it's being checked.
 */
export function receiptReceivedAck(courtName: string, startsAt: Date, endsAt: Date): string {
  return (
    `🧾 *¡Recibí tu comprobante!* Lo estamos verificando.\n\n` +
    `Apenas el club lo confirme te aviso por acá y te queda asegurada *${courtName} · ` +
    `${formatDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}*. 🎾`
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

// ── Reply composition (text + botonera) ──────────────────────────────────────
// When the bot sends a botonera, the options are already visible as buttons/rows, so the
// body must NOT re-list them. These concise bodies replace the enumerated text in that case;
// when no botonera fits (e.g. >10 options) the full enumerated text is sent instead.

/** First line of the MENU block — used to detect a genuine menu presentation. */
const MENU_PROMPT_MARKER = '¿Qué querés hacer?'
/** Concise menu body shown above the menu button (no enumerated list). */
const MENU_CONCISE = `¿Qué querés hacer? Tocá una opción 👇\n\nO escribime con tus palabras (ej: *"un turno el sábado a la tarde"*).`

function courtsPrompt(ctx: SessionContext): string {
  // Reached only when a chosen time is free on several courts → "pick a court for that time".
  if (ctx.selectedSlotLabel) {
    return `🎾 A las *${ctx.selectedSlotLabel}* del *${fmtDate(ctx.selectedDate!)}*, ¿en qué cancha? 👇`
  }
  return `🎾 Para el *${fmtDate(ctx.selectedDate!)}* tengo estas canchas con lugar 👇`
}

function slotsPrompt(ctx: SessionContext): string {
  // With the time-first flow there's usually no single court yet — keep the prompt generic.
  if (ctx.selectedCourtName) {
    return `⏰ Horarios libres en *${ctx.selectedCourtName}* el *${fmtDate(ctx.selectedDate!)}* 👇`
  }
  return `⏰ Elegí un horario para el *${fmtDate(ctx.selectedDate!)}* y te asigno la cancha 👇`
}

/** The body to send when a botonera is attached: a concise prompt instead of the listed options. */
function conciseBody(state: BotState, ctx: SessionContext, text: string): string {
  switch (state) {
    case BotState.IDLE:
    case BotState.MENU:
      return text.replace(MENU, MENU_CONCISE)
    case BotState.BOOK_COURT:
      return courtsPrompt(ctx)
    case BotState.BOOK_SLOT:
    case BotState.RESCHEDULE_SLOT:
      return slotsPrompt(ctx)
    default:
      // BOOK_CONFIRM body is a summary, not an option list — keep it.
      return text
  }
}

/**
 * Pairs the bot's text with the botonera that fits the step. When a botonera is attached the
 * body is made concise so the options aren't duplicated above the buttons. Menu buttons are
 * only attached to an actual menu presentation — a payment/advisor/terminal message that
 * merely lands on the MENU state keeps its plain text.
 *
 * `prefix` (an answer to a question, an apology) is prepended and always survives, because
 * the concise body REPLACES the text: without this, the bot's actual words would vanish and
 * the player would just see "Elegí un horario 👇" as the answer to their question.
 */
export function composeBotReply(state: BotState, ctx: SessionContext, text: string, prefix?: string): BotReply {
  const lead = prefix ? `${prefix}\n\n` : ''
  let interactive = buildInteractive(state, ctx)
  if ((state === BotState.MENU || state === BotState.IDLE) && !text.includes(MENU_PROMPT_MARKER)) {
    interactive = undefined
  }
  if (!interactive) return { text: `${lead}${text}` }
  return { text: `${lead}${conciseBody(state, ctx, text)}`, interactive }
}

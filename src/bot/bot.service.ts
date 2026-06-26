import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { BookingsService } from '../bookings/bookings.service'
import { AvailabilityService } from '../availability/availability.service'
import { formatDayMonth, formatTimeRange, todayKey } from '../availability/lib/datetime'
import { LlmService } from '../llm/llm.service'
import { ConversationSessionService, keepName } from './conversation-session.service'
import { matchCourt, matchSlot } from './lib/match'
import { BotReply, BotState, BookingOption, HandlerResult, SessionContext } from './types'
import {
  ADVISOR_HANDOFF,
  ASK_DATE,
  ASK_DNI,
  ASK_NAME,
  BAD_DNI,
  ATTACHMENT_NO_PENDING,
  BOOKING_ABORTED,
  BOOKING_FAILED,
  CANCEL_ABORTED,
  CANCEL_CONFIRMED,
  CANCEL_FAILED,
  MENU,
  NO_BOOKINGS,
  NO_SLOTS,
  PAYMENT_CLAIM_NO_PENDING,
  PAYMENT_UNAVAILABLE,
  TECHNICAL_ERROR,
  cancelList,
  composeBotReply,
  confirmBooking,
  confirmCancel,
  courtsList,
  myBookingsList,
  noAvailabilityWithSuggestions,
  paymentClaimAck,
  slotsList,
  thanksReply,
  transferPending,
  welcome,
} from './messages'

/** Inbound messages are truncated to this length before processing (cost / abuse guard). */
const MAX_MESSAGE_LENGTH = 1000

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly availability: AvailabilityService,
    private readonly sessionService: ConversationSessionService,
    private readonly llmService: LlmService,
  ) {}

  async handleMessage(waId: string, clubId: string, body: string): Promise<BotReply | null> {
    try {
      return await this.runMessage(waId, clubId, body)
    } catch (err) {
      // Never leave the user "en visto": on any internal failure (DB hiccup, LLM outage…)
      // send a friendly courtesy reply and keep the conversation alive.
      this.logger.error(`Failed to handle message from ${waId}`, err)
      return { text: TECHNICAL_ERROR }
    }
  }

  private async runMessage(waId: string, clubId: string, body: string): Promise<BotReply | null> {
    const session = await this.sessionService.getOrCreate(waId, clubId)
    // Cap length so a pathologically long message can't bloat the LLM prompt / cost.
    const msg = body.trim().slice(0, MAX_MESSAGE_LENGTH)

    // Always persist the incoming message for admin visibility.
    await this.sessionService.saveMessage(session.id, 'USER', msg)

    // In HUMAN mode the admin handles the reply — bot stays silent.
    if (session.mode === 'HUMAN') {
      return null
    }

    const state = session.state as BotState
    const isMenuState = state === BotState.MENU || state === BotState.IDLE

    // Talk-to-a-human: option 3 from the menu, or a natural-language request. Hands the
    // conversation over and flags it for the panel. Only honored from the menu/idle so it
    // doesn't hijack a mid-booking reply.
    const wantsAdvisor = (state === BotState.MENU && msg === '3') || (isMenuState && isAdvisorRequest(msg))

    const result = wantsAdvisor
      ? await this.advisorReply(session.id, session.context)
      : // "Ya transferí" / "te mando el comprobante" after booking: acknowledge and let the
        // poller confirm the real money — never from a claim.
        isPaymentClaim(msg) && isMenuState
        ? await this.paymentClaimReply(clubId, waId, session.context)
        : await this.dispatch(state, msg, session.context, clubId, waId)

    // Keep last 8 messages (4 turns) so the LLM has short-term conversational context.
    const prevHistory = session.context.history ?? []
    const newHistory = [
      ...prevHistory,
      { role: 'user' as const, content: msg },
      { role: 'assistant' as const, content: result.reply },
    ].slice(-8)

    await this.sessionService.update(session.id, result.state, { ...result.ctx, history: newHistory })
    await this.sessionService.saveMessage(session.id, 'BOT', result.reply)
    // Pair the reply with the botonera that fits the next step (menu, courts, slots, yes/no…)
    // and trim the body so options aren't listed twice. Tapping a button feeds its id back
    // through this same handler, so the FSM is unchanged.
    return composeBotReply(result.state, result.ctx, result.reply)
  }

  /**
   * Reply to an inbound image/document (typically a transfer receipt). We don't read
   * the file — the poller confirms the actual money — so we just reassure the player.
   */
  async handleAttachment(waId: string, clubId: string): Promise<BotReply | null> {
    try {
      return await this.runAttachment(waId, clubId)
    } catch (err) {
      this.logger.error(`Failed to handle attachment from ${waId}`, err)
      return { text: TECHNICAL_ERROR }
    }
  }

  private async runAttachment(waId: string, clubId: string): Promise<BotReply | null> {
    const session = await this.sessionService.getOrCreate(waId, clubId)
    await this.sessionService.saveMessage(session.id, 'USER', '[Imagen / comprobante recibido]')

    if (session.mode === 'HUMAN') {
      return null
    }

    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    if (!pending) return { text: ATTACHMENT_NO_PENDING }
    const { startsAt, endsAt, court } = pending.slot
    const reply = paymentClaimAck(court.name, startsAt, endsAt, pending.transferAmountCents)
    await this.sessionService.saveMessage(session.id, 'BOT', reply)
    return { text: reply }
  }

  /** Builds the "we're waiting for your transfer" reply, keeping the FSM state put. */
  private async paymentClaimReply(clubId: string, waId: string, ctx: SessionContext): Promise<HandlerResult> {
    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    if (!pending) return { reply: PAYMENT_CLAIM_NO_PENDING, state: BotState.MENU, ctx: keepName(ctx) }
    const { startsAt, endsAt, court } = pending.slot
    return {
      reply: paymentClaimAck(court.name, startsAt, endsAt, pending.transferAmountCents),
      state: BotState.MENU,
      ctx: keepName(ctx),
    }
  }

  // ── Dispatcher ─────────────────────────────────────────────────────────────

  private dispatch(
    state: BotState,
    msg: string,
    ctx: SessionContext,
    clubId: string,
    waId: string,
  ): Promise<HandlerResult> {
    switch (state) {
      case BotState.IDLE:
        // First message of a (new or expired) session. Greet only on a bare
        // greeting; otherwise act on the intent immediately instead of dropping
        // it behind a generic welcome.
        return this.onIdle(msg, ctx, clubId, waId)
      case BotState.MENU:
        return this.onMenu(msg, ctx, clubId, waId)
      case BotState.BOOK_DATE:
        return this.onBookDate(msg, ctx, clubId, waId)
      case BotState.BOOK_NAME:
        return this.onBookName(msg, ctx, clubId)
      case BotState.BOOK_COURT:
        return this.onBookCourt(msg, ctx, clubId, waId)
      case BotState.BOOK_SLOT:
        return this.onBookSlot(msg, ctx, clubId, waId)
      case BotState.BOOK_CONFIRM:
        return this.onBookConfirm(msg, ctx, clubId, waId)
      case BotState.BOOK_DNI:
        return this.onBookDni(msg, ctx, clubId, waId)
      case BotState.CANCEL_SELECT:
        return this.onCancelSelect(msg, ctx, clubId, waId)
      case BotState.CANCEL_CONFIRM:
        return this.onCancelConfirm(msg, ctx, clubId)
      default:
        return Promise.resolve({ reply: welcome(ctx.playerName), state: BotState.MENU, ctx })
    }
  }

  /**
   * Guard placed in front of every LLM fallback: trivial intents (greetings, thanks)
   * are answered with a predefined message — for free — and only genuinely ambiguous
   * messages reach the LLM. Applied across all flows so we don't pay for "hola"/"gracias".
   */
  private fallback(
    state: BotState,
    msg: string,
    ctx: SessionContext,
    clubId: string,
    waId: string,
  ): Promise<HandlerResult> {
    const cheap = this.cheapReply(state, msg, ctx)
    if (cheap) return Promise.resolve(cheap)
    return this.llmService.handleFallback(state, msg, ctx, clubId, waId)
  }

  /**
   * A predefined answer for a trivial intent, or null when the message is real intent
   * that the LLM should interpret. On the menu a greeting/thanks returns the menu;
   * mid-flow it keeps the player on the current step instead of resetting.
   */
  private cheapReply(state: BotState, msg: string, ctx: SessionContext): HandlerResult | null {
    const menuLike = state === BotState.MENU || state === BotState.IDLE

    if (isGreeting(msg)) {
      if (menuLike) return { reply: welcome(ctx.playerName), state: BotState.MENU, ctx }
      const step = stepPrompt(state, ctx)
      if (step) {
        const hi = ctx.playerName ? `👋 ¡Hola, ${ctx.playerName}!` : '👋 ¡Hola!'
        return { reply: `${hi} Seguimos con lo que estábamos 🎾\n\n${step}`, state, ctx }
      }
    }

    if (isThanks(msg)) {
      if (menuLike) return { reply: thanksReply(ctx.playerName), state: BotState.MENU, ctx }
      const step = stepPrompt(state, ctx)
      if (step) return { reply: `¡De nada! 🎾\n\n${step}`, state, ctx }
    }

    return null
  }

  // ── State handlers ─────────────────────────────────────────────────────────

  private onIdle(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    // A bare greeting / empty message → warm welcome with the menu (personalized
    // with the player's name when we know it — no LLM call needed).
    if (isGreeting(msg)) {
      return Promise.resolve({ reply: welcome(ctx.playerName), state: BotState.MENU, ctx })
    }
    // Anything else is real intent → handle it as if we were already at the menu.
    return this.onMenu(msg, ctx, clubId, waId)
  }

  private async onMenu(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    if (msg === '1') return { reply: ASK_DATE, state: BotState.BOOK_DATE, ctx }
    if (msg === '2') return this.buildMyBookings(ctx, clubId, waId)
    // '3' (advisor) is handled before dispatch. Cancel is reachable by word so we don't
    // need the LLM for it.
    if (/\b(cancelar|anular|dar de baja)\b/i.test(msg)) return this.buildCancelList(ctx, clubId, waId)
    // Natural language → LLM interprets intent
    return this.fallback(BotState.MENU, msg, ctx, clubId, waId)
  }

  /** Hands the conversation to a human advisor and flags it for the panel. */
  private async advisorReply(sessionId: string, ctx: SessionContext): Promise<HandlerResult> {
    await this.sessionService.requestAdvisor(sessionId)
    return { reply: ADVISOR_HANDOFF, state: BotState.MENU, ctx: keepName(ctx) }
  }

  private async onBookDate(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const date = parseDateDMY(msg)
    if (!date) {
      // Could be "mañana", "el sábado", etc. → LLM resolves
      return this.fallback(BotState.BOOK_DATE, msg, ctx, clubId, waId)
    }

    const courts = await this.availability.courtsForDate(clubId, date)
    if (courts.length === 0) {
      // Don't dead-end: offer the nearest days that do have availability and
      // stay in BOOK_DATE so the player can just reply with one of them.
      const suggestions = await this.availability.nextAvailableDates(clubId, date, { excludeDateKey: date })
      return { reply: noAvailabilityWithSuggestions(date, suggestions), state: BotState.BOOK_DATE, ctx }
    }

    const nextCtx: SessionContext = { ...ctx, selectedDate: date, courtOptions: courts }

    if (!ctx.playerName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: nextCtx }

    return { reply: courtsList(courts, date), state: BotState.BOOK_COURT, ctx: nextCtx }
  }

  private async onBookName(msg: string, ctx: SessionContext, clubId: string): Promise<HandlerResult> {
    // Accept a correction phrase ("me llamo X") or a bare name; reject anything that
    // doesn't look like a person's name (digits, time/date phrasings, too long).
    const name = extractName(msg)
    if (!name) {
      return {
        reply: 'Mmm, eso no parece un nombre 🤔 Decime tu nombre (sin números ni horarios), ¿cómo te llamás?',
        state: BotState.BOOK_NAME,
        ctx,
      }
    }

    const nextCtx: SessionContext = { ...ctx, playerName: name }

    // LLM may have pre-filled slot → skip straight to confirmation
    if (nextCtx.selectedSlotId && nextCtx.selectedCourtId) {
      return { reply: confirmBooking(nextCtx), state: BotState.BOOK_CONFIRM, ctx: nextCtx }
    }

    // LLM may have pre-filled court + slots → skip to slot selection
    if (nextCtx.selectedCourtId && nextCtx.slotOptions?.length) {
      return {
        reply: slotsList(nextCtx.slotOptions, nextCtx.selectedCourtName!, nextCtx.selectedDate!),
        state: BotState.BOOK_SLOT,
        ctx: nextCtx,
      }
    }

    // Normal flow → show courts
    const courts = nextCtx.courtOptions ?? (await this.availability.courtsForDate(clubId, nextCtx.selectedDate!))
    if (courts.length === 0) {
      const suggestions = await this.availability.nextAvailableDates(clubId, nextCtx.selectedDate!, {
        excludeDateKey: nextCtx.selectedDate,
      })
      return {
        reply: noAvailabilityWithSuggestions(nextCtx.selectedDate!, suggestions),
        state: BotState.BOOK_DATE,
        ctx: nextCtx,
      }
    }

    return {
      reply: courtsList(courts, nextCtx.selectedDate!),
      state: BotState.BOOK_COURT,
      ctx: { ...nextCtx, courtOptions: courts },
    }
  }

  private async onBookCourt(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const courts = ctx.courtOptions ?? []
    const court = matchCourt(msg, courts)

    if (!court) {
      // Couldn't pin a court by name → let the LLM resolve looser phrasings.
      return this.fallback(BotState.BOOK_COURT, msg, ctx, clubId, waId)
    }

    // "Suggest court at time" flow: the time was already chosen, so resolve that band
    // on the picked court and go straight to confirmation.
    if (ctx.selectedBandStart) {
      const slots = await this.availability.slotsForDate(clubId, ctx.selectedDate!, court.id)
      const slot = slots.find(s => s.bandStart === ctx.selectedBandStart)
      if (slot) {
        const nextCtx: SessionContext = {
          ...ctx,
          selectedCourtId: court.id,
          selectedCourtName: court.name,
          slotOptions: slots,
          selectedSlotId: slot.slotId,
          selectedBandStart: slot.bandStart,
          selectedSlotLabel: slot.label,
          selectedSlotPrice: slot.price,
        }
        return { reply: confirmBooking(nextCtx), state: BotState.BOOK_CONFIRM, ctx: nextCtx }
      }
      // Band no longer free on this court → fall back to the normal slot list below.
    }

    const slots = await this.availability.slotsForDate(clubId, ctx.selectedDate!, court.id)

    if (slots.length === 0) {
      return { reply: NO_SLOTS, state: BotState.MENU, ctx: keepName(ctx) }
    }

    return {
      reply: slotsList(slots, court.name, ctx.selectedDate!),
      state: BotState.BOOK_SLOT,
      ctx: { ...ctx, selectedCourtId: court.id, selectedCourtName: court.name, slotOptions: slots },
    }
  }

  private async onBookSlot(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const slots = ctx.slotOptions ?? []
    const slot = matchSlot(msg, slots)

    if (!slot) {
      // Non-time phrasings ("el último", "el primero") → LLM resolves.
      return this.fallback(BotState.BOOK_SLOT, msg, ctx, clubId, waId)
    }

    const nextCtx: SessionContext = {
      ...ctx,
      selectedSlotId: slot.slotId,
      selectedBandStart: slot.bandStart,
      selectedSlotLabel: slot.label,
      selectedSlotPrice: slot.price,
    }

    return { reply: confirmBooking(nextCtx), state: BotState.BOOK_CONFIRM, ctx: nextCtx }
  }

  private async onBookConfirm(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    // "Mi nombre está mal, me llamo X" → fix the name and re-show the summary.
    const correctedName = extractNameCorrection(msg)
    if (correctedName) {
      const fixed: SessionContext = { ...ctx, playerName: correctedName }
      return {
        reply: `¡Listo, lo corregí! 🙌\n\n${confirmBooking(fixed)}`,
        state: BotState.BOOK_CONFIRM,
        ctx: fixed,
      }
    }

    const answer = normalizeYesNo(msg)

    if (!answer) {
      return {
        reply: `Perdón, no te entendí del todo 🤔\n\n${confirmBooking(ctx)}`,
        state: BotState.BOOK_CONFIRM,
        ctx,
      }
    }
    if (answer === 'n') {
      return { reply: BOOKING_ABORTED, state: BotState.MENU, ctx: keepName(ctx) }
    }

    // The club must have a transfer alias configured before we lock a slot the
    // player can't actually pay for.
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { transferAlias: true, transferHolder: true, depositMode: true, requireDniMatch: true },
    })
    if (!club?.transferAlias) {
      return { reply: PAYMENT_UNAVAILABLE, state: BotState.MENU, ctx: keepName(ctx) }
    }

    // Strict mode: we need the player's DNI to validate the transfer's titular.
    // Reuse a DNI this phone already gave us so a returning player is never asked twice.
    if (club.requireDniMatch && !ctx.playerDni) {
      const knownDni = await this.bookingsService.findKnownDniForPhone(clubId, waId)
      if (!knownDni) {
        return { reply: ASK_DNI, state: BotState.BOOK_DNI, ctx }
      }
      ctx = { ...ctx, playerDni: knownDni }
    }

    return this.createPendingBooking(clubId, waId, ctx, {
      transferAlias: club.transferAlias,
      transferHolder: club.transferHolder,
      depositMode: club.depositMode,
      requireDniMatch: club.requireDniMatch,
    })
  }

  private async onBookDni(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const dni = msg.replace(/\D/g, '')
    if (dni.length < 7 || dni.length > 8) {
      return { reply: BAD_DNI, state: BotState.BOOK_DNI, ctx }
    }

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { transferAlias: true, transferHolder: true, depositMode: true, requireDniMatch: true },
    })
    if (!club?.transferAlias) {
      return { reply: PAYMENT_UNAVAILABLE, state: BotState.MENU, ctx: keepName(ctx) }
    }

    return this.createPendingBooking(
      clubId,
      waId,
      { ...ctx, playerDni: dni },
      {
        transferAlias: club.transferAlias,
        transferHolder: club.transferHolder,
        depositMode: club.depositMode,
        requireDniMatch: club.requireDniMatch,
      },
    )
  }

  /** Locks the slot with a pending booking and tells the player exactly how much to transfer. */
  private async createPendingBooking(
    clubId: string,
    waId: string,
    ctx: SessionContext,
    club: {
      transferAlias: string
      transferHolder: string | null
      depositMode: 'DEPOSIT' | 'FULL'
      requireDniMatch: boolean
    },
  ): Promise<HandlerResult> {
    let pendingBooking: { id: string; transferAmountCents: number }
    try {
      if (ctx.selectedSlotId) {
        pendingBooking = await this.bookingsService.bookPending(clubId, {
          slotId: ctx.selectedSlotId,
          playerName: ctx.playerName!,
          playerPhone: waId,
          playerDni: ctx.playerDni,
        })
      } else {
        pendingBooking = await this.bookingsService.bookBandPending(clubId, {
          courtId: ctx.selectedCourtId!,
          dateKey: ctx.selectedDate!,
          bandStart: ctx.selectedBandStart!,
          playerName: ctx.playerName!,
          playerPhone: waId,
          playerDni: ctx.playerDni,
        })
      }
    } catch {
      return { reply: BOOKING_FAILED, state: BotState.MENU, ctx: keepName(ctx) }
    }

    return {
      reply: transferPending(
        ctx,
        { alias: club.transferAlias, holder: club.transferHolder },
        pendingBooking.transferAmountCents,
        club.depositMode,
        club.requireDniMatch,
      ),
      state: BotState.MENU,
      ctx: keepName(ctx),
    }
  }

  private async onCancelSelect(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    if (msg === '0') return { reply: MENU, state: BotState.MENU, ctx: keepName(ctx) }

    const options = ctx.bookingOptions ?? []
    const idx = parseInt(msg, 10) - 1

    if (isNaN(idx) || idx < 0 || idx >= options.length) {
      // Could be a description like "el del sábado" → LLM resolves
      return this.fallback(BotState.CANCEL_SELECT, msg, ctx, clubId, waId)
    }

    const booking = options[idx]
    return {
      reply: confirmCancel(booking.label),
      state: BotState.CANCEL_CONFIRM,
      ctx: { ...ctx, selectedBookingId: booking.id, selectedBookingLabel: booking.label },
    }
  }

  private async onCancelConfirm(msg: string, ctx: SessionContext, clubId: string): Promise<HandlerResult> {
    const answer = normalizeYesNo(msg)

    if (!answer) {
      return {
        reply: `Perdón, no te entendí del todo 🤔\n\n${confirmCancel(ctx.selectedBookingLabel!)}`,
        state: BotState.CANCEL_CONFIRM,
        ctx,
      }
    }
    if (answer === 'n') {
      return { reply: CANCEL_ABORTED, state: BotState.MENU, ctx: keepName(ctx) }
    }

    try {
      await this.bookingsService.cancel(clubId, ctx.selectedBookingId!)
      return { reply: CANCEL_CONFIRMED, state: BotState.MENU, ctx: keepName(ctx) }
    } catch {
      return { reply: CANCEL_FAILED, state: BotState.MENU, ctx: keepName(ctx) }
    }
  }

  // ── Transient view builders ────────────────────────────────────────────────

  private async buildMyBookings(ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const bookings = await this.findUserBookings(clubId, waId)
    if (bookings.length === 0) return { reply: NO_BOOKINGS, state: BotState.MENU, ctx }
    const options = bookings.map(b => ({ id: b.id, label: bookingLabel(b) }))
    return { reply: myBookingsList(options), state: BotState.MENU, ctx }
  }

  private async buildCancelList(ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const bookings = await this.findUserBookings(clubId, waId)
    if (bookings.length === 0) return { reply: NO_BOOKINGS, state: BotState.MENU, ctx }
    const options: BookingOption[] = bookings.map(b => ({ id: b.id, label: bookingLabel(b) }))
    return { reply: cancelList(options), state: BotState.CANCEL_SELECT, ctx: { ...ctx, bookingOptions: options } }
  }

  // ── DB queries ─────────────────────────────────────────────────────────────

  private findUserBookings(clubId: string, waId: string) {
    return this.prisma.booking.findMany({
      where: { clubId, playerPhone: waId, status: 'CONFIRMED' },
      select: {
        id: true,
        slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
      },
      orderBy: { slot: { startsAt: 'asc' } },
    })
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Parses "DD/MM" or "D/M" into "YYYY-MM-DD".
 * If the date has already passed this year, assumes next year.
 * Today is resolved in the club timezone so the year rollover is consistent
 * with how the rest of the bot reasons about dates.
 */
function parseDateDMY(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[/-](\d{1,2})$/)
  if (!m) return null

  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  // Validate the calendar day (rejects 31/02, etc.) using a UTC probe.
  const probe = new Date(Date.UTC(2000, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null

  const [todayY, todayM, todayD] = todayKey().split('-').map(Number)
  let year = todayY
  const isBeforeToday = month < todayM || (month === todayM && day < todayD)
  if (isBeforeToday) year += 1

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** True when the player asks to talk to a human advisor (or about tournaments). */
function isAdvisorRequest(msg: string): boolean {
  const t = msg
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  return (
    /\b(asesor|operador|humano|encargad|torneo|torneos)\b/.test(t) ||
    /\bcon (una persona|alguien|un humano|un asesor)\b/.test(t) ||
    /\bhablar con\b/.test(t)
  )
}

/** A name: 1–5 words of letters (accents ok), no digits, 2–50 chars. */
function isNameLike(s: string): boolean {
  if (s.length < 2 || s.length > 50 || /\d/.test(s)) return false
  return /^[\p{L}][\p{L}\s'’-]*$/u.test(s) && s.split(/\s+/).length <= 5
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** Extracts a corrected name from "me llamo X" / "mi nombre es X" / "a nombre de X", or null. */
function extractNameCorrection(msg: string): string | null {
  const m = msg.match(/(?:me llamo|mi nombre es|a nombre de|me dicen)\s+([\p{L}][\p{L}\s'’-]{1,49}?)(?=[.,!?\n]|$)/iu)
  if (!m) return null
  const candidate = m[1].trim()
  return isNameLike(candidate) ? titleCase(candidate) : null
}

/** A usable player name from a message: a "me llamo X" phrase or a bare name; else null. */
function extractName(msg: string): string | null {
  const corrected = extractNameCorrection(msg)
  if (corrected) return corrected
  const name = msg.trim().replace(/[.,!?]+$/, '')
  return isNameLike(name) ? titleCase(name) : null
}

/** True when the message reads like "I already paid / here's the receipt". */
function isPaymentClaim(msg: string): boolean {
  // NFD + strip diacritics so "depósito"/"aboné" match the accent-free stems below.
  const normalized = msg
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  return /\b(transfer|comprobante|deposit|ya pag|ya abon|ya envi|ya hice|ya mand)/.test(normalized)
}

/**
 * The re-prompt for the current flow step, rebuilt from the session context — used to
 * keep a player oriented after a cheap greeting/thanks mid-flow without an LLM call.
 * Returns null when the step can't be rebuilt (let the LLM handle it instead).
 */
function stepPrompt(state: BotState, ctx: SessionContext): string | null {
  switch (state) {
    case BotState.BOOK_DATE:
      return ASK_DATE
    case BotState.BOOK_COURT:
      return ctx.courtOptions?.length && ctx.selectedDate ? courtsList(ctx.courtOptions, ctx.selectedDate) : null
    case BotState.BOOK_SLOT:
      return ctx.slotOptions?.length && ctx.selectedCourtName && ctx.selectedDate
        ? slotsList(ctx.slotOptions, ctx.selectedCourtName, ctx.selectedDate)
        : null
    case BotState.CANCEL_SELECT:
      return ctx.bookingOptions?.length ? cancelList(ctx.bookingOptions) : null
    default:
      return null
  }
}

/** True for short "thanks" messages — cheap to answer without the LLM. */
function isThanks(msg: string): boolean {
  const t = msg
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[!¡¿?.,]/g, '')
    .trim()
  if (t.length === 0 || t.split(/\s+/).length > 4) return false
  return /\b(gracias|graciass|graciasss|thanks|thank you|thx)\b/.test(t)
}

/** True for bare greetings / openers where a welcome makes sense. */
function isGreeting(msg: string): boolean {
  const t = msg
    .toLowerCase()
    .trim()
    .replace(/[!¡¿?.,]/g, '')
  if (t.length === 0) return true
  const GREETINGS = new Set([
    'hola',
    'holaa',
    'holaaa',
    'buenas',
    'buenass',
    'hey',
    'ey',
    'ola',
    'menu',
    'menú',
    'inicio',
    'empezar',
    'start',
    'buen dia',
    'buen día',
    'buenos dias',
    'buenos días',
    'buenas tardes',
    'buenas noches',
    'que tal',
    'qué tal',
    'hola buenas',
  ])
  return GREETINGS.has(t)
}

/**
 * Normalizes a free-text reply to 's' | 'n' | null. Matches whole words (so "no"
 * inside another word doesn't trigger) and handles common phrases, so people can
 * answer naturally ("dale", "sí confirmo", "mejor no") instead of just S/N.
 */
function normalizeYesNo(msg: string): 's' | 'n' | null {
  const text = msg
    .toLowerCase()
    .trim()
    .replace(/[!¡¿?.,]/g, '')
  const words = text.split(/\s+/)

  const NO = new Set(['n', 'no', 'nop', 'nope', 'nel', 'negativo', 'cancelar', 'cancela', 'tampoco'])
  const YES = new Set([
    's',
    'si',
    'sí',
    'sip',
    'sii',
    'dale',
    'va',
    'ok',
    'oka',
    'okey',
    'okay',
    'bueno',
    'buenisimo',
    'buenísimo',
    'claro',
    'obvio',
    'confirmo',
    'confirmar',
    'confirmá',
    'confirma',
    'listo',
    'adelante',
    'perfecto',
    'genial',
    'joya',
    'correcto',
  ])

  const hasYesWord = words.some(w => YES.has(w))
  const hasNoWord = words.some(w => NO.has(w))

  // Explicit decline phrases win over a stray affirmative.
  if (/\bmejor no\b|\bno gracias\b|\bdej[aá]lo\b|\bahora no\b/.test(text)) return 'n'
  // A leading "no" ("no, dale") is a decline.
  if (hasNoWord && !hasYesWord) return 'n'
  if (hasYesWord && !hasNoWord) return 's'
  return null
}

function bookingLabel(b: { slot: { startsAt: Date; endsAt: Date; court: { name: string } } }): string {
  const dateStr = formatDayMonth(b.slot.startsAt)
  return `${dateStr} · ${b.slot.court.name} · ${formatTimeRange(b.slot.startsAt, b.slot.endsAt)}`
}

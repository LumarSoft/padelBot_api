import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { BookingsService } from '../bookings/bookings.service'
import { AvailabilityService } from '../availability/availability.service'
import { todayKey } from '../availability/lib/datetime'
import { LlmService } from '../llm/llm.service'
import { ConversationSessionService, keepName } from './conversation-session.service'
import { matchCourt, matchSlot } from './lib/match'
import {
  assignCheapestForBand,
  availabilityResult,
  isAnyCourt,
  mentionsTime,
  resolveBand,
  resolveCourtAtBand,
} from './lib/booking-flow'
import { WhatsAppMediaService } from '../whatsapp/whatsapp-media.service'
import { ReceiptStorageService } from '../storage/receipt-storage.service'
import { BotReply, BotState, HandlerResult, InboundMedia, SessionContext } from './types'
import {
  ASK_DATE,
  ASK_DNI,
  ASK_NAME,
  BAD_DNI,
  ATTACHMENT_NO_PENDING,
  BOOKING_ABORTED,
  BOOKING_FAILED,
  PAYMENT_CLAIM_NO_PENDING,
  PAYMENT_UNAVAILABLE,
  RECEIPT_ATTACHMENT_FAILED,
  RECEIPT_ATTACHMENT_NO_PENDING,
  RECEIPT_CLAIM_ASK_PHOTO,
  TECHNICAL_ERROR,
  composeBotReply,
  confirmBooking,
  courtsAtTimeList,
  dayAvailabilityList,
  noAvailabilityWithSuggestions,
  paymentClaimAck,
  receiptReceivedAck,
  slotsList,
  thanksReply,
  timeNotAvailable,
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
    private readonly media: WhatsAppMediaService,
    private readonly receiptStorage: ReceiptStorageService,
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

    this.logger.log(`📥 IN  ${waId} [${session.state}]: ${logSnippet(msg)}`)

    // "/reset" command: wipe the whole chat and start fresh. Handled before persisting the
    // message (so "/reset" itself isn't kept) and before the HUMAN guard so it always works.
    if (msg.toLowerCase() === '/reset') {
      await this.sessionService.reset(session.id)
      this.logger.log(`♻️  ${waId}: chat reseteado (/reset)`)
      return { text: '🧹 Listo, borré la conversación. Empezamos de cero — escribime *hola* cuando quieras. 🎾' }
    }

    // Always persist the incoming message for admin visibility.
    await this.sessionService.saveMessage(session.id, 'USER', msg)

    // In HUMAN mode the admin handles the reply — bot stays silent.
    if (session.mode === 'HUMAN') {
      this.logger.log(`🙋 ${waId}: modo HUMANO, el bot no responde`)
      return null
    }

    const state = session.state as BotState
    const isMenuState = state === BotState.MENU || state === BotState.IDLE

    // "Ya transferí" / "te mando el comprobante" after booking: acknowledge and let the
    // poller confirm the real money — never from a claim.
    const result =
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
    // The actual WhatsApp send is logged at the transport layer (WhatsAppService), which also
    // captures system messages (payment notifications) — so we don't log the reply twice here.
    // Pair the reply with the botonera that fits the next step (menu, courts, slots, yes/no…)
    // and trim the body so options aren't listed twice. Tapping a button feeds its id back
    // through this same handler, so the FSM is unchanged.
    return composeBotReply(result.state, result.ctx, result.reply)
  }

  /**
   * Reply to an inbound image/document (typically a transfer receipt). In RECEIPT mode the
   * club verifies the receipt by hand, so we download and store the image and flag it for the
   * admin. In AUTO mode the poller confirms the actual money, so we just reassure the player.
   */
  async handleAttachment(waId: string, clubId: string, media: InboundMedia | null): Promise<BotReply | null> {
    try {
      return await this.runAttachment(waId, clubId, media)
    } catch (err) {
      this.logger.error(`Failed to handle attachment from ${waId}`, err)
      return { text: TECHNICAL_ERROR }
    }
  }

  private async runAttachment(waId: string, clubId: string, media: InboundMedia | null): Promise<BotReply | null> {
    const session = await this.sessionService.getOrCreate(waId, clubId)
    this.logger.log(`📥 IN  ${waId}: [imagen/comprobante ${media?.mimeType ?? 'desconocido'}]`)
    await this.sessionService.saveMessage(session.id, 'USER', '[Imagen / comprobante recibido]')

    if (session.mode === 'HUMAN') {
      this.logger.log(`🙋 ${waId}: modo HUMANO, el bot no responde`)
      return null
    }

    const mode = await this.paymentVerificationMode(clubId)
    const reply =
      mode === 'RECEIPT'
        ? await this.storeReceipt(waId, clubId, media)
        : await this.acknowledgeReceiptClaim(clubId, waId)

    await this.sessionService.saveMessage(session.id, 'BOT', reply)
    return { text: reply }
  }

  /** AUTO mode: the poller confirms the money, so we only reassure the player. */
  private async acknowledgeReceiptClaim(clubId: string, waId: string): Promise<string> {
    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    if (!pending) return ATTACHMENT_NO_PENDING
    const { startsAt, endsAt, court } = pending.slot
    return paymentClaimAck(court.name, startsAt, endsAt, pending.transferAmountCents)
  }

  /**
   * RECEIPT mode: download the image from Meta, store it, attach it to the player's pending
   * booking and flag it for the admin to verify. Returns the player-facing acknowledgement.
   */
  private async storeReceipt(waId: string, clubId: string, media: InboundMedia | null): Promise<string> {
    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    if (!pending) return RECEIPT_ATTACHMENT_NO_PENDING
    if (!media) return RECEIPT_ATTACHMENT_FAILED

    const downloaded = await this.media.download(media.mediaId)
    if (!downloaded) return RECEIPT_ATTACHMENT_FAILED

    const mimeType = downloaded.mimeType || media.mimeType || 'image/jpeg'
    const key = `receipts/${pending.id}/${Date.now()}-${media.mediaId}${extensionFor(mimeType)}`

    try {
      const stored = await this.receiptStorage.upload(key, downloaded.bytes, mimeType)
      await this.bookingsService.attachReceipt(clubId, pending.id, {
        storageKey: stored.key,
        url: stored.url,
        mimeType,
        sizeBytes: downloaded.bytes.length,
        waMediaId: media.mediaId,
      })
    } catch (err) {
      this.logger.error(`Failed to store receipt for booking ${pending.id}`, err)
      return RECEIPT_ATTACHMENT_FAILED
    }

    const { startsAt, endsAt, court } = pending.slot
    return receiptReceivedAck(court.name, startsAt, endsAt)
  }

  /** The club's payment verification mode (AUTO reconciliation vs manual receipt review). */
  private async paymentVerificationMode(clubId: string): Promise<'AUTO' | 'RECEIPT'> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { paymentVerificationMode: true },
    })
    return club?.paymentVerificationMode ?? 'AUTO'
  }

  /** Builds the "we're waiting for your transfer" reply, keeping the FSM state put. */
  private async paymentClaimReply(clubId: string, waId: string, ctx: SessionContext): Promise<HandlerResult> {
    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    if (!pending) return { reply: PAYMENT_CLAIM_NO_PENDING, state: BotState.MENU, ctx: keepName(ctx) }
    const { startsAt, endsAt, court } = pending.slot
    // In RECEIPT mode a text "ya transferí" isn't enough — ask for the receipt photo.
    const mode = await this.paymentVerificationMode(clubId)
    const reply =
      mode === 'RECEIPT'
        ? RECEIPT_CLAIM_ASK_PHOTO
        : paymentClaimAck(court.name, startsAt, endsAt, pending.transferAmountCents)
    return { reply, state: BotState.MENU, ctx: keepName(ctx) }
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
    // Natural language → LLM interprets intent
    return this.fallback(BotState.MENU, msg, ctx, clubId, waId)
  }

  private async onBookDate(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const date = parseDateDMY(msg)
    if (!date) {
      // Could be "mañana", "el sábado", etc. → LLM resolves
      return this.fallback(BotState.BOOK_DATE, msg, ctx, clubId, waId)
    }

    const bands = await this.availability.availableBandsForDate(clubId, date)
    if (bands.length === 0) {
      // Don't dead-end: offer the nearest days that do have availability and
      // stay in BOOK_DATE so the player can just reply with one of them.
      const suggestions = await this.availability.nextAvailableDates(clubId, date, { excludeDateKey: date })
      return { reply: noAvailabilityWithSuggestions(date, suggestions), state: BotState.BOOK_DATE, ctx }
    }

    // Need the name first; remember the date so we don't re-ask it.
    if (!ctx.playerName) {
      return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: { ...ctx, selectedDate: date } }
    }

    // Show the day's availability grouped by court; the player picks a time, no court step.
    return availabilityResult(ctx, bands, date)
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

    // LLM/flow may have pre-filled a full slot → straight to confirmation.
    if (nextCtx.selectedSlotId && nextCtx.selectedCourtId) {
      return { reply: confirmBooking(nextCtx), state: BotState.BOOK_CONFIRM, ctx: nextCtx }
    }

    // A time was already chosen (deferred until we had the name) → resolve it now.
    if (nextCtx.selectedBandStart && nextCtx.dayAvailability?.length) {
      return resolveBand(nextCtx, nextCtx.selectedBandStart)
    }

    // Explicit-court path (player named a court) → show that court's free times.
    if (nextCtx.selectedCourtId && nextCtx.slotOptions?.length) {
      return {
        reply: slotsList(nextCtx.slotOptions, nextCtx.selectedCourtName!, nextCtx.selectedDate!),
        state: BotState.BOOK_SLOT,
        ctx: nextCtx,
      }
    }

    // Normal flow → show the day's availability (recomputing only if we don't have it yet).
    const bands =
      nextCtx.dayAvailability ?? (await this.availability.availableBandsForDate(clubId, nextCtx.selectedDate!))
    if (bands.length === 0) {
      const suggestions = await this.availability.nextAvailableDates(clubId, nextCtx.selectedDate!, {
        excludeDateKey: nextCtx.selectedDate,
      })
      return {
        reply: noAvailabilityWithSuggestions(nextCtx.selectedDate!, suggestions),
        state: BotState.BOOK_DATE,
        ctx: nextCtx,
      }
    }
    return availabilityResult(nextCtx, bands, nextCtx.selectedDate!)
  }

  /** Only reached when a chosen time is free on several courts — the player picks one (or "cualquiera"). */
  private async onBookCourt(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    if (!ctx.selectedBandStart) {
      // No time chosen yet (shouldn't happen in the time-first flow) → defer to the LLM.
      return this.fallback(BotState.BOOK_COURT, msg, ctx, clubId, waId)
    }

    // "Cualquiera / la que sea" → assign the cheapest free court for that time.
    if (isAnyCourt(msg)) {
      return assignCheapestForBand(ctx, ctx.selectedBandStart)
    }

    const court = matchCourt(msg, ctx.courtOptions ?? [])
    if (!court) {
      // Looser phrasing → let the LLM resolve it.
      return this.fallback(BotState.BOOK_COURT, msg, ctx, clubId, waId)
    }

    const resolved = resolveCourtAtBand(ctx, court)
    if (resolved) return resolved

    // The band is no longer free on that court → re-derive the day's availability fresh.
    const bands = await this.availability.availableBandsForDate(clubId, ctx.selectedDate!)
    if (bands.length === 0) {
      const suggestions = await this.availability.nextAvailableDates(clubId, ctx.selectedDate!, {
        excludeDateKey: ctx.selectedDate,
      })
      return { reply: noAvailabilityWithSuggestions(ctx.selectedDate!, suggestions), state: BotState.BOOK_DATE, ctx }
    }
    return availabilityResult(ctx, bands, ctx.selectedDate!)
  }

  private async onBookSlot(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const slot = matchSlot(msg, ctx.slotOptions ?? [])

    if (slot) {
      // A real free band → auto-assign a court, or ask which one if several are free.
      return resolveBand(ctx, slot.bandStart)
    }

    // A specific hour that isn't in the list → it's just not free; show what is.
    if (mentionsTime(msg) && ctx.dayAvailability?.length) {
      return { reply: timeNotAvailable(ctx.dayAvailability, ctx.selectedDate!), state: BotState.BOOK_SLOT, ctx }
    }

    // Non-time phrasings ("el último", "el más temprano", a court name) → LLM resolves.
    return this.fallback(BotState.BOOK_SLOT, msg, ctx, clubId, waId)
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
      select: {
        transferAlias: true,
        transferHolder: true,
        depositMode: true,
        requireDniMatch: true,
        paymentVerificationMode: true,
      },
    })
    if (!club?.transferAlias) {
      return { reply: PAYMENT_UNAVAILABLE, state: BotState.MENU, ctx: keepName(ctx) }
    }

    // Strict (AUTO) mode: we need the player's DNI to validate the transfer's titular. The DNI
    // is irrelevant in RECEIPT mode (an admin verifies the photo by hand), so we skip it there.
    // Reuse a DNI this phone already gave us so a returning player is never asked twice.
    if (club.requireDniMatch && club.paymentVerificationMode !== 'RECEIPT' && !ctx.playerDni) {
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
      paymentVerificationMode: club.paymentVerificationMode,
    })
  }

  private async onBookDni(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const dni = msg.replace(/\D/g, '')
    if (dni.length < 7 || dni.length > 8) {
      return { reply: BAD_DNI, state: BotState.BOOK_DNI, ctx }
    }

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: {
        transferAlias: true,
        transferHolder: true,
        depositMode: true,
        requireDniMatch: true,
        paymentVerificationMode: true,
      },
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
        paymentVerificationMode: club.paymentVerificationMode,
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
      paymentVerificationMode: 'AUTO' | 'RECEIPT'
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
        club.paymentVerificationMode,
      ),
      state: BotState.MENU,
      ctx: keepName(ctx),
    }
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** One-line, length-capped version of a message for clean console logs. */
function logSnippet(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…'
}

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

/** A file extension for a stored receipt, derived from its mime type (defaults to .jpg). */
function extensionFor(mimeType: string): string {
  if (mimeType.includes('png')) return '.png'
  if (mimeType.includes('webp')) return '.webp'
  if (mimeType.includes('pdf')) return '.pdf'
  return '.jpg'
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

/**
 * True when the message reads like "I already paid / here's the receipt" — including the
 * receipt-photo intent ("foto", "comprobante", "captura"). In RECEIPT mode these are routed
 * to a deterministic "send me the photo" reply, so the LLM never wrongly claims the bot can't
 * receive images.
 */
function isPaymentClaim(msg: string): boolean {
  // NFD + strip diacritics so "depósito"/"aboné" match the accent-free stems below.
  const normalized = msg
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  return /\b(transfer|comprobante|deposit|foto|imagen|captura|pantallazo|screenshot|adjunt|ya pag|ya abon|ya envi|ya hice|ya mand|te (lo |la )?(mando|envio|paso|adjunto))/.test(
    normalized,
  )
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
    case BotState.BOOK_COURT: {
      // The "free on several courts at this time" step → re-show that list.
      if (!ctx.selectedBandStart || !ctx.selectedDate) return null
      const band = ctx.dayAvailability?.find(b => b.bandStart === ctx.selectedBandStart)
      return band
        ? courtsAtTimeList(
            band.courts.map(c => ({ name: c.name, price: c.price })),
            band.label,
            ctx.selectedDate,
          )
        : null
    }
    case BotState.BOOK_SLOT:
      if (!ctx.selectedDate) return null
      // Explicit single court → its slot list; otherwise the day's availability.
      if (ctx.selectedCourtName && ctx.slotOptions?.length) {
        return slotsList(ctx.slotOptions, ctx.selectedCourtName, ctx.selectedDate)
      }
      return ctx.dayAvailability?.length ? dayAvailabilityList(ctx.dayAvailability, ctx.selectedDate) : null
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

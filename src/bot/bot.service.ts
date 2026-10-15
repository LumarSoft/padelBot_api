import { ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { DepositMode, PaymentVerificationMode } from 'generated/prisma/client'
import { dniFromIdentification } from '../common/identity'
import { PrismaService } from '../prisma/prisma.service'
import { BookingsService, NoShowReviewRequiredException, PendingBookingResult } from '../bookings/bookings.service'
import { AvailabilityService } from '../availability/availability.service'
import {
  dayLabelFromKey,
  dayMonthFromKey,
  formatTime,
  formatTimeRange,
  shiftDateKey,
  toDateKey,
  todayKey,
  wallTimeToUtc,
  weekdayOfKey,
} from '../availability/lib/datetime'
import { LlmService } from '../llm/llm.service'
import { ConversationSessionService, SessionSnapshot, keepName } from './conversation-session.service'
import { matchByTime, matchCourt, matchSlot } from './lib/match'
import { parseDateExpression } from './lib/date-parse'
import { stepPrompt } from './lib/step-prompt'
import {
  assignCheapestForBand,
  availabilityResult,
  bandsToSlotOptions,
  isAnyCourt,
  resolveBand,
  resolveCourtAtBand,
} from './lib/booking-flow'
import { PART_OF_DAY_NAMES, bandsInPart, parsePartOfDay } from './lib/part-of-day'
import { subscriptionSelect, subscriptionState } from '../clubs/lib/subscription'
import { WaitlistService } from '../waitlist/waitlist.service'
import { PlayersService } from '../players/players.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CreditsService } from '../plans/credits.service'
import { WhatsAppMediaService } from '../whatsapp/whatsapp-media.service'
import { ReceiptStorageService } from '../storage/receipt-storage.service'
import {
  BotReply,
  BotState,
  HandlerResult,
  InboundMedia,
  MY_BOOKING_PREFIX,
  MyBookingOption,
  SessionContext,
} from './types'
import {
  ASK_DATE,
  ASK_NAME,
  BAD_DNI,
  ATTACHMENT_NO_DEPOSIT,
  ATTACHMENT_NO_PENDING,
  SKIP_DNI_INTENT,
  DNI_NOTED,
  receiptLinkedAck,
  AUDIO_NOT_UNDERSTOOD,
  BOOKING_ABORTED,
  BOOKING_FAILED,
  NO_UPCOMING_BOOKINGS,
  RESCHEDULE_ABORTED,
  RESCHEDULE_FAILED,
  RESCHEDULE_NO_DAY_WORKS,
  RESCHEDULE_OFF,
  PAYMENT_CLAIM_NO_PENDING,
  PAYMENT_UNAVAILABLE,
  RECEIPT_ATTACHMENT_FAILED,
  RECEIPT_ATTACHMENT_NO_PENDING,
  RECEIPT_CLAIM_ASK_PHOTO,
  TECHNICAL_ERROR,
  askRescheduleDate,
  bookingConfirmedNoDeposit,
  composeBotReply,
  confirmBooking,
  dayAvailabilityList,
  myBookingsList,
  noAvailabilityWithSuggestions,
  noShowReviewRequested,
  rescheduleConfirm,
  rescheduleDone,
  rescheduleRequested,
  paymentClaimAck,
  receiptReceivedAck,
  slotsList,
  thanksReply,
  transferPending,
  welcome,
  creditsPausedNotice,
} from './messages'

/** Inbound messages are truncated to this length before processing (cost / abuse guard). */
const MAX_MESSAGE_LENGTH = 1000

const WEEKDAY_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** "¿Cómo llegar?" in its usual forms — answered from Club.locationInfo. */
const LOCATION_QUESTION = /c[oó]mo lleg|direcci[oó]n|ubicaci[oó]n|d[oó]nde (est[aá]n|queda)/i

/**
 * "Mis turnos" / "quiero cancelar" — answered from the player's own bookings, no LLM. These
 * are among the most common messages a club gets, and until now the bot had no answer for
 * them: they fell through to a model with no tool to cancel anything.
 */
/** "No puedo ningún otro día" — the escape hatch out of the reschedule flow, into a human. */
const NO_DAY_WORKS =
  /\bning[uú]n (otro )?d[ií]a\b|\bno puedo ning|\bno me sirve ning|\bno voy a poder ir\b|\bmejor cancel/i

const MY_BOOKINGS_INTENT =
  /\bmis (turnos|reservas)\b|\bque turnos tengo\b|\bqué turnos tengo\b|\bcancelar\b|\banular\b|\bdar de baja\b|\bno voy a (poder )?(ir|jugar)\b/i

/**
 * "Quiero hablar con una persona" and its variants — an explicit request for a human. Routed
 * deterministically to a staff hand-off (mode → HUMAN + push) instead of the LLM, which has no
 * tool to switch modes and would just keep answering as the bot.
 */
const HUMAN_HANDOFF_INTENT =
  /\bhablar con (una |un )?(persona|humano|alguien|encargad[oa]|due[nñ]o|operador|asesor|agente)\b|\b(con |una )?persona (real|de verdad)\b|\batenci[oó]n humana\b|\bun humano\b|\bquiero (hablar|comunicarme) con (alguien|una persona|un humano)\b/i

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
    private readonly waitlist: WaitlistService,
    private readonly players: PlayersService,
    private readonly notifications: NotificationsService,
    private readonly credits: CreditsService,
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
    // Soft subscription guard: a club whose trial/payment lapsed past the grace window
    // gets a polite fallback instead of the booking flow (never a silent dead line).
    const blockedReply = await this.subscriptionBlockedReply(clubId)
    if (blockedReply) return blockedReply

    // Cap length so a pathologically long message can't bloat the LLM prompt / cost.
    const msg = body.trim().slice(0, MAX_MESSAGE_LENGTH)
    const paused = await this.creditsPausedReply(waId, clubId, msg)
    if (paused) return paused.reply

    const session = await this.sessionService.getOrCreate(waId, clubId)

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

    // In HUMAN mode the admin handles the reply — bot stays silent. Every branch that can
    // speak to the player MUST sit below this guard: an admin who took over the chat is
    // mid-conversation with the player, and a bot message on top of theirs is a mess only
    // the club can clean up.
    if (await this.isHumanHandled(session, waId)) return null

    // Explicit "quiero hablar con una persona" → hand the chat to staff and go quiet, so the
    // player never gets stuck talking to a bot they've asked to get past.
    if (HUMAN_HANDOFF_INTENT.test(msg)) {
      return this.handoffToHuman(session.id, waId, clubId)
    }

    // "avisame" right after a no-availability reply → join that day's waitlist.
    const sessionCtx = session.context
    if (sessionCtx.waitlistOfferDate && /\bavis(a|á)me\b|\bavisarme\b/i.test(msg)) {
      const dateKey = sessionCtx.waitlistOfferDate
      await this.waitlist.join(clubId, waId, dateKey, sessionCtx.playerName)
      const reply =
        `🔔 ¡Listo! Si se libera un turno el *${dayLabelFromKey(dateKey)}* te aviso al toque por acá. ` +
        `Mientras tanto podés reservar otro día cuando quieras. 🎾`
      await this.sessionService.saveMessage(session.id, 'BOT', reply)
      await this.sessionService.update(session.id, BotState.MENU, { ...keepName(sessionCtx) })
      return { text: reply }
    }

    const state = session.state as BotState
    const isMenuState = state === BotState.MENU || state === BotState.IDLE

    // A bare DNI while a deposit is pending: it identifies who will transfer, so the poller
    // can match the payment. Optional — the receipt photo does the same job.
    if (isMenuState) {
      const dniReply = await this.pendingDniReply(clubId, waId, msg)
      if (dniReply) {
        await this.sessionService.saveMessage(session.id, 'BOT', dniReply)
        return { text: dniReply }
      }
    }

    // "Ya transferí" / "te mando el comprobante" after booking: acknowledge and let the
    // poller confirm the real money — never from a claim.
    const result =
      (await this.repeatFlowResult(msg, state, session.context, clubId, waId)) ??
      (isPaymentClaim(msg) && isMenuState ? await this.paymentClaimReply(clubId, waId, session.context) : null) ??
      (await this.dispatch(state, msg, session.context, clubId, waId))

    // What the bot actually said (answer + step prompt) — the history and the admin's chat
    // view must show that, not just the step prompt.
    const said = fullReply(result)

    // Keep last 8 messages (4 turns) so the LLM has short-term conversational context.
    const prevHistory = session.context.history ?? []
    const newHistory = [
      ...prevHistory,
      { role: 'user' as const, content: msg },
      { role: 'assistant' as const, content: said },
    ].slice(-8)

    await this.sessionService.update(session.id, result.state, { ...result.ctx, history: newHistory })
    await this.sessionService.saveMessage(session.id, 'BOT', said)
    // The actual WhatsApp send is logged at the transport layer (WhatsAppService), which also
    // captures system messages (payment notifications) — so we don't log the reply twice here.
    // Pair the reply with the botonera that fits the next step (menu, courts, slots, yes/no…)
    // and trim the body so options aren't listed twice. Tapping a button feeds its id back
    // through this same handler, so the FSM is unchanged.
    return composeBotReply(result.state, result.ctx, result.reply, result.prefix)
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
    const blockedReply = await this.subscriptionBlockedReply(clubId)
    if (blockedReply) return blockedReply

    // Without a booking waiting for its deposit, an image is not a receipt: read it instead.
    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    if (!pending) {
      // A receipt for a pending booking still goes through (that money is moving); anything
      // else waits for the staff while the bot is paused.
      const paused = await this.creditsPausedReply(waId, clubId, '[Imagen]')
      if (paused) return paused.reply
      const answered = await this.replyToImage(waId, clubId, media)
      if (answered) return answered
    }

    const session = await this.sessionService.getOrCreate(waId, clubId)
    this.logger.log(`📥 IN  ${waId}: [imagen/comprobante ${media?.mimeType ?? 'desconocido'}]`)
    await this.sessionService.saveMessage(session.id, 'USER', '[Imagen / comprobante recibido]')

    if (await this.isHumanHandled(session, waId)) return null

    const payment = await this.paymentSettings(clubId)
    // No seña to wait for: an image we couldn't read is not a receipt of anything.
    const reply =
      !pending && payment.depositMode === DepositMode.NONE
        ? ATTACHMENT_NO_DEPOSIT
        : payment.verificationMode === 'RECEIPT'
          ? await this.storeReceipt(waId, clubId, media)
          : await this.acknowledgeReceipt(clubId, waId, media)

    await this.sessionService.saveMessage(session.id, 'BOT', reply)
    return { text: reply }
  }

  /**
   * A voice note: transcribed and then handled exactly like the same words typed — so every
   * flow (booking, cancel, FAQ, LLM fallback) works by audio with no special cases.
   */
  async handleAudio(waId: string, clubId: string, media: InboundMedia | null): Promise<BotReply | null> {
    try {
      const downloaded = media ? await this.media.download(media.mediaId, media.phoneNumberId) : null
      const transcript = downloaded
        ? await this.llmService.transcribeAudio(
            clubId,
            waId,
            downloaded.bytes,
            downloaded.mimeType || media?.mimeType || 'audio/ogg',
          )
        : null
      if (transcript) return await this.handleMessage(waId, clubId, transcript)

      const paused = await this.creditsPausedReply(waId, clubId, '[Audio]')
      if (paused) return paused.reply

      const session = await this.sessionService.getOrCreate(waId, clubId)
      await this.sessionService.saveMessage(session.id, 'USER', '[Audio]')
      if (await this.isHumanHandled(session, waId)) return null
      await this.sessionService.saveMessage(session.id, 'BOT', AUDIO_NOT_UNDERSTOOD)
      return { text: AUDIO_NOT_UNDERSTOOD }
    } catch (err) {
      this.logger.error(`Failed to handle audio from ${waId}`, err)
      return { text: TECHNICAL_ERROR }
    }
  }

  /**
   * An image that isn't a receipt for a pending booking (a flyer, a screenshot of the
   * schedule…): we let the model describe it and answer that like a typed message. Returns null
   * when it can't be read, so the caller falls back to the plain acknowledgement.
   */
  private async replyToImage(waId: string, clubId: string, media: InboundMedia | null): Promise<BotReply | null> {
    if (!media || !media.mimeType?.startsWith('image/')) return null
    const downloaded = await this.media.download(media.mediaId, media.phoneNumberId)
    if (!downloaded) return null
    const description = await this.llmService.describeImage(
      clubId,
      waId,
      downloaded.bytes,
      downloaded.mimeType || media.mimeType,
      media.caption,
    )
    if (!description) return null
    const text = media.caption
      ? `${media.caption}\n(El jugador mandó una imagen: ${description})`
      : `(El jugador mandó una imagen: ${description})`
    return this.handleMessage(waId, clubId, text)
  }

  /** Stores a DNI typed while the player's deposit is pending; null when it doesn't apply. */
  private async pendingDniReply(clubId: string, waId: string, msg: string): Promise<string | null> {
    if (!/^\s*\d{1,2}\.?\d{3}\.?\d{3}\s*$/.test(msg)) return null
    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    if (!pending || pending.playerDni) return null
    const dni = msg.replace(/\D/g, '')
    await this.bookingsService.recordPendingPlayerDni(pending.id, dni)
    return DNI_NOTED
  }

  /**
   * AUTO mode: the poller confirms the money. If the photo is a readable receipt, we keep who
   * paid (CUIT/DNI) and the operation number on the booking, so the poller can match the real
   * MercadoPago transfer even when someone else paid. The photo never confirms on its own.
   */
  private async acknowledgeReceipt(clubId: string, waId: string, media: InboundMedia | null): Promise<string> {
    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    if (!pending) return ATTACHMENT_NO_PENDING
    const { startsAt, endsAt, court } = pending.slot

    const reading = await this.readReceipt(clubId, waId, media)
    if (!reading) return paymentClaimAck(court.name, startsAt, endsAt, pending.transferAmountCents)

    await this.bookingsService.recordReceiptReading(pending.id, {
      payerDni: dniFromIdentification(reading.payerTaxId),
      operationRef: reading.operationNumber?.replace(/\D/g, '') || null,
    })
    const readCents = reading.amount != null ? Math.round(reading.amount * 100) : null
    const expected = pending.transferAmountCents
    const mismatch =
      readCents != null && expected != null && Math.abs(readCents - expected) >= 100
        ? { expectedCents: expected, readCents }
        : null
    return receiptLinkedAck(court.name, startsAt, endsAt, mismatch)
  }

  private async readReceipt(clubId: string, waId: string, media: InboundMedia | null) {
    if (!media?.mimeType?.startsWith('image/')) return null
    const downloaded = await this.media.download(media.mediaId, media.phoneNumberId)
    if (!downloaded) return null
    return this.llmService.readTransferReceipt(clubId, waId, downloaded.bytes, downloaded.mimeType || media.mimeType)
  }

  /**
   * RECEIPT mode: download the image from Meta, store it, attach it to the player's pending
   * booking and flag it for the admin to verify. Returns the player-facing acknowledgement.
   */
  private async storeReceipt(waId: string, clubId: string, media: InboundMedia | null): Promise<string> {
    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    if (!pending) return RECEIPT_ATTACHMENT_NO_PENDING
    if (!media) return RECEIPT_ATTACHMENT_FAILED

    const downloaded = await this.media.download(media.mediaId, media.phoneNumberId)
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

  /** How the club charges (seña / full / nothing) and verifies it (AUTO reconciliation vs receipt). */
  private async paymentSettings(
    clubId: string,
  ): Promise<{ depositMode: DepositMode; verificationMode: PaymentVerificationMode }> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { depositMode: true, paymentVerificationMode: true },
    })
    return {
      depositMode: club?.depositMode ?? DepositMode.DEPOSIT,
      verificationMode: club?.paymentVerificationMode ?? PaymentVerificationMode.AUTO,
    }
  }

  /**
   * "Lo de siempre" for regulars, in two moves:
   * 1. A greeting at the menu, when the player has a habitual slot (same weekday +
   *    time + court repeated >=2 times), gets the welcome plus a one-line shortcut.
   * 2. Answering "repetir" (or "lo de siempre") jumps straight to the CONFIRM step of
   *    the next occurrence — if it's still free — so a regular books in 3 taps.
   * Returns null when this flow doesn't apply (normal dispatch continues).
   */
  private async repeatFlowResult(
    msg: string,
    state: BotState,
    ctx: SessionContext,
    clubId: string,
    waId: string,
  ): Promise<HandlerResult | null> {
    const menuLike = state === BotState.MENU || state === BotState.IDLE

    // "Cómo llegar" — answered from the club's own copy at any point of the chat.
    if (LOCATION_QUESTION.test(msg)) {
      const copy = await this.clubCopy(clubId)
      const reply = copy.locationInfo
        ? `📍 *Cómo llegar:*\n${copy.locationInfo}`
        : `📍 No tengo la dirección cargada acá, pero el club te la pasa al toque si les escribís directo. 🙏`
      return { reply, state, ctx }
    }

    // (1) Greeting -> welcome, plus the club's own line and the regular's shortcut.
    if (menuLike && isGreeting(msg)) {
      const [habit, copy] = await Promise.all([this.players.habitualBooking(clubId, waId), this.clubCopy(clubId)])
      if (!habit && !copy.botWelcomeExtra) return null
      const extra = copy.botWelcomeExtra ? `\n\n${copy.botWelcomeExtra}` : ''
      const hint = habit
        ? `\n\n💡 ¿Repetís lo de siempre? *${WEEKDAY_LABELS[habit.weekday]} ${habit.bandStart}* en ` +
          `*${habit.courtName}* — respondé *repetir* y te lo reservo.`
        : ''
      return {
        reply: welcome(ctx.playerName) + extra + hint,
        state: BotState.MENU,
        ctx: habit ? { ...ctx, habit } : ctx,
      }
    }

    // (2) "repetir" -> seed the normal confirm step for the next free occurrence.
    if (!menuLike || !/\brepetir\b|\blo de siempre\b/i.test(msg)) return null
    const habit = ctx.habit ?? (await this.players.habitualBooking(clubId, waId))
    if (!habit) return null

    const dateKey = this.nextOccurrenceKey(habit.weekday, habit.bandStart)
    const options = await this.availability.slotsForDate(clubId, dateKey, habit.courtId)
    const slot = options.find(o => o.bandStart === habit.bandStart)
    if (!slot) {
      return {
        reply:
          `😕 Tu turno de siempre (*${dayLabelFromKey(dateKey)} ${habit.bandStart}* en *${habit.courtName}*) ` +
          `ya está tomado esta vez. Decime otra fecha y te busco lugar. 🎾`,
        state: BotState.BOOK_DATE,
        ctx: keepName(ctx),
      }
    }

    const seeded: SessionContext = {
      ...keepName(ctx),
      selectedDate: dateKey,
      selectedCourtId: habit.courtId,
      selectedCourtName: habit.courtName,
      selectedBandStart: slot.bandStart,
      selectedSlotId: slot.slotId,
      selectedSlotLabel: slot.label,
      selectedSlotPrice: slot.price,
    }
    // Without a name the confirm step can't complete — the flow asks it first.
    if (!seeded.playerName) {
      return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: seeded }
    }
    return { reply: confirmBooking(seeded), state: BotState.BOOK_CONFIRM, ctx: seeded }
  }

  /** The club's configurable bot copy (welcome extra + cómo llegar). */
  private async clubCopy(clubId: string): Promise<{ botWelcomeExtra: string | null; locationInfo: string | null }> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { botWelcomeExtra: true, locationInfo: true },
    })
    return { botWelcomeExtra: club?.botWelcomeExtra ?? null, locationInfo: club?.locationInfo ?? null }
  }

  /** Next club-local date (today included if the start is still ahead) for a weekday+time. */
  private nextOccurrenceKey(weekday: number, bandStart: string): string {
    const today = todayKey()
    const daysUntil = (weekday - weekdayOfKey(today) + 7) % 7
    const candidate = shiftDateKey(today, daysUntil)
    if (daysUntil === 0 && wallTimeToUtc(candidate, bandStart) <= new Date()) {
      return shiftDateKey(candidate, 7)
    }
    return candidate
  }

  /**
   * Returns the fallback reply when the club's GTP subscription is blocked
   * (cancelled, or trial/payment lapsed beyond the grace window), else null.
   * The player is redirected to the club itself — the club's relationship with
   * its players must survive our billing.
   */
  private async subscriptionBlockedReply(clubId: string): Promise<BotReply | null> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { name: true, ...subscriptionSelect },
    })
    if (!club || subscriptionState(club).botAllowed) return null
    this.logger.warn(`Bot blocked for club ${clubId} (subscription ${club.subscriptionStatus})`)
    return {
      text:
        `😕 Las reservas por WhatsApp de *${club.name}* están deshabilitadas por el momento. ` +
        `Comunicate directamente con el club para reservar. ¡Gracias!`,
    }
  }

  /**
   * The bot is paused because the club used up its month's credits: the player's message is
   * kept for the staff (Conversaciones), and the player is told once per conversation that the
   * club answers by hand — never a silent dead line, never a word about credits. The staff gets
   * a push with it. Null when the bot isn't paused; `reply: null` = stay quiet.
   */
  private async creditsPausedReply(
    waId: string,
    clubId: string,
    playerText: string,
  ): Promise<{ reply: BotReply | null } | null> {
    if (!(await this.credits.botPaused(clubId))) return null

    const session = await this.sessionService.getOrCreate(waId, clubId)
    await this.sessionService.saveMessage(session.id, 'USER', playerText)
    this.logger.log(`⏸️  ${waId}: bot pausado sin créditos, lo atiende el club`)
    if (session.mode === 'HUMAN' || session.context.creditsPausedNotified) return { reply: null }

    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { name: true } })
    const reply = creditsPausedNotice(club?.name ?? 'el club')
    await this.sessionService.update(session.id, session.state as BotState, {
      ...session.context,
      creditsPausedNotified: true,
    })
    await this.sessionService.saveMessage(session.id, 'BOT', reply)
    await this.notifications.notifyClub(clubId, {
      title: '⏸️ Un jugador escribió y el bot está pausado',
      body: `Respondele desde Conversaciones (${waId}). Se terminaron los créditos de IA del mes.`,
    })
    return { reply: { text: reply } }
  }

  /**
   * Builds the "we're waiting for your transfer" reply, keeping the FSM state put. Null when it
   * doesn't apply: at a club with no seña and nothing pending, "¿hay que transferir?" is a
   * question for the normal flow, not a payment claim.
   */
  private async paymentClaimReply(clubId: string, waId: string, ctx: SessionContext): Promise<HandlerResult | null> {
    const pending = await this.bookingsService.findActivePendingForPlayer(clubId, waId)
    const payment = await this.paymentSettings(clubId)
    if (!pending) {
      if (payment.depositMode === DepositMode.NONE) return null
      return { reply: PAYMENT_CLAIM_NO_PENDING, state: BotState.MENU, ctx: keepName(ctx) }
    }
    const { startsAt, endsAt, court } = pending.slot
    // In RECEIPT mode a text "ya transferí" isn't enough — ask for the receipt photo.
    const reply =
      payment.verificationMode === 'RECEIPT'
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
      case BotState.MY_BOOKINGS:
        return this.onMyBookings(msg, ctx, clubId, waId)
      case BotState.RESCHEDULE_DATE:
        return this.onRescheduleDate(msg, ctx, clubId, waId)
      case BotState.RESCHEDULE_SLOT:
        return this.onRescheduleSlot(msg, ctx, clubId, waId)
      case BotState.RESCHEDULE_CONFIRM:
        return this.onRescheduleConfirm(msg, ctx, clubId, waId)
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
        return { prefix: `${hi} Seguimos con lo que estábamos 🎾`, reply: step, state, ctx }
      }
    }

    if (isThanks(msg)) {
      if (menuLike) return { reply: thanksReply(ctx.playerName), state: BotState.MENU, ctx }
      const step = stepPrompt(state, ctx)
      if (step) return { prefix: '¡De nada! 🎾', reply: step, state, ctx }
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
    if (msg === '2' || MY_BOOKINGS_INTENT.test(msg)) return this.showMyBookings(clubId, waId, ctx)
    // Natural language → LLM interprets intent
    return this.fallback(BotState.MENU, msg, ctx, clubId, waId)
  }

  /**
   * "Mis turnos": the player's own upcoming bookings, tappable. Deterministic on purpose —
   * "quiero cancelar el turno del sábado" is a common message and it used to reach the LLM,
   * which had no tool to do anything about it and answered something vague.
   */
  private async showMyBookings(clubId: string, waId: string, ctx: SessionContext): Promise<HandlerResult> {
    const bookings = await this.bookingsService.findUpcomingForPlayer(clubId, waId)
    if (bookings.length === 0) {
      return { reply: NO_UPCOMING_BOOKINGS, state: BotState.MENU, ctx: keepName(ctx) }
    }

    const options: MyBookingOption[] = bookings.map(b => ({
      id: b.id,
      label: `${dayLabelFromKey(toDateKey(b.slot.startsAt))} · ${formatTimeRange(b.slot.startsAt, b.slot.endsAt)} · ${b.slot.court.name}`,
      short: `${dayMonthFromKey(toDateKey(b.slot.startsAt))} · ${formatTime(b.slot.startsAt)}`,
      bandStart: formatTime(b.slot.startsAt),
      courtName: b.slot.court.name,
      pending: b.status === 'PENDING_PAYMENT',
    }))

    return {
      reply: myBookingsList(options),
      state: BotState.MY_BOOKINGS,
      ctx: { ...ctx, myBookings: options, rescheduleBookingId: undefined },
    }
  }

  /**
   * The player picked one of their bookings. The bot never cancels it — it offers to MOVE it,
   * which keeps their deposit alive, frees the old court for the waitlist, and costs the club
   * nothing. Whether they may do that alone is the club's policy.
   */
  private async onMyBookings(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const picked = matchMyBooking(msg, ctx.myBookings ?? [])
    if (!picked) {
      // Not a booking reference — maybe they want to book instead. Let the LLM read it.
      return this.fallback(BotState.MY_BOOKINGS, msg, ctx, clubId, waId)
    }

    const policy = await this.bookingsService.reschedulePolicyForPlayer(clubId, picked.id, waId)
    if (!policy) return { reply: RESCHEDULE_FAILED, state: BotState.MENU, ctx: keepName(ctx) }

    if (policy.mode === 'OFF') {
      // The club handles changes/cancellations itself — but don't send the player "off" the
      // club's own WhatsApp: notify the staff so someone picks it up on this same chat.
      await this.askClubToHandle(clubId, waId, picked.label, 'club-policy')
      return { reply: RESCHEDULE_OFF, state: BotState.MENU, ctx: keepName(ctx) }
    }
    if (policy.mode === 'REQUEST') {
      await this.askClubToHandle(clubId, waId, picked.label, policy.reason)
      return {
        reply: rescheduleRequested(policy.reason as 'club-policy' | 'too-late' | 'limit-reached'),
        state: BotState.MENU,
        ctx: keepName(ctx),
      }
    }

    return {
      reply: askRescheduleDate(picked.label, policy.carriesDeposit),
      state: BotState.RESCHEDULE_DATE,
      ctx: {
        ...keepName(ctx),
        rescheduleBookingId: picked.id,
        rescheduleFromLabel: picked.label,
        rescheduleFromPriceCents: policy.priceCents,
        rescheduleCarriesDeposit: policy.carriesDeposit,
      },
    }
  }

  /** The new day for a booking being moved. Same parsing (and same free botonera) as booking. */
  private async onRescheduleDate(
    msg: string,
    ctx: SessionContext,
    clubId: string,
    waId: string,
  ): Promise<HandlerResult> {
    // "No puedo ningún día" → never trap them in the flow: hand it to a human. A player who
    // gives up on the chat just doesn't show up, which is worse for the club than being told.
    if (NO_DAY_WORKS.test(msg)) return this.handOverToClub(clubId, waId, ctx)

    const date = parseDateExpression(msg)
    if (!date) return this.fallback(BotState.RESCHEDULE_DATE, msg, ctx, clubId, waId)

    const bands = await this.availability.availableBandsForDate(clubId, date)
    if (bands.length === 0) {
      const suggestions = await this.availability.nextAvailableDates(clubId, date, { excludeDateKey: date })
      const offerWaitlist = await this.waitlist.offeredIn(clubId)
      return {
        reply: noAvailabilityWithSuggestions(date, suggestions, offerWaitlist),
        state: BotState.RESCHEDULE_DATE,
        ctx: { ...ctx, waitlistOfferDate: offerWaitlist ? date : undefined },
      }
    }

    return {
      reply: dayAvailabilityList(bands, date),
      state: BotState.RESCHEDULE_SLOT,
      ctx: { ...ctx, selectedDate: date, dayAvailability: bands, slotOptions: bandsToSlotOptions(bands) },
    }
  }

  /** The new hour. A move doesn't ask which court — the cheapest free one is assigned. */
  private async onRescheduleSlot(
    msg: string,
    ctx: SessionContext,
    clubId: string,
    waId: string,
  ): Promise<HandlerResult> {
    if (NO_DAY_WORKS.test(msg)) return this.handOverToClub(clubId, waId, ctx)

    const bands = ctx.dayAvailability ?? []

    const part = parsePartOfDay(msg)
    if (part && bands.length) {
      const inPart = bandsInPart(bands, part)
      return {
        prefix: `Horarios de la *${PART_OF_DAY_NAMES[part]}* 👇`,
        reply: dayAvailabilityList(inPart, ctx.selectedDate!),
        state: BotState.RESCHEDULE_SLOT,
        ctx: { ...ctx, slotOptions: bandsToSlotOptions(inPart) },
      }
    }

    const slot = matchSlot(msg, bands.length ? bandsToSlotOptions(bands) : (ctx.slotOptions ?? []))
    if (!slot) {
      // Same as BOOK_SLOT: the LLM answers anything the matcher couldn't place, reading the
      // real availability rather than asserting from a failed regex.
      const withFullDay = bands.length ? { ...ctx, slotOptions: bandsToSlotOptions(bands) } : ctx
      return this.fallback(BotState.RESCHEDULE_SLOT, msg, withFullDay, clubId, waId)
    }

    // Assign the cheapest free court for that hour — a move is not the moment to make the
    // player pick a court they didn't ask about.
    const assigned = assignCheapestForBand(ctx, slot.bandStart)
    if (assigned.state !== BotState.BOOK_CONFIRM) {
      // The band is gone (someone took it while they were deciding) → assigned re-shows what's free.
      return { ...assigned, state: BotState.RESCHEDULE_SLOT }
    }

    const next = assigned.ctx
    const priceDiff = (next.selectedSlotPrice ?? 0) - (ctx.rescheduleFromPriceCents ?? 0)
    return {
      reply: rescheduleConfirm(ctx.rescheduleFromLabel ?? 'tu turno', next, priceDiff, ctx.rescheduleCarriesDeposit),
      state: BotState.RESCHEDULE_CONFIRM,
      ctx: next,
    }
  }

  /** Final yes/no on the move. Only an explicit "sí" touches the booking. */
  private async onRescheduleConfirm(
    msg: string,
    ctx: SessionContext,
    clubId: string,
    waId: string,
  ): Promise<HandlerResult> {
    const answer = normalizeYesNo(msg)
    if (!answer) {
      // Usually a question ("¿y la diferencia?"). The LLM may answer it; the step is re-asked
      // underneath and only the "sí" below moves anything.
      return this.fallback(BotState.RESCHEDULE_CONFIRM, msg, ctx, clubId, waId)
    }
    if (answer === 'n' || !ctx.rescheduleBookingId) {
      return { reply: RESCHEDULE_ABORTED, state: BotState.MENU, ctx: keepName(ctx) }
    }

    const moved = await this.bookingsService.rescheduleToBandByPlayer(clubId, ctx.rescheduleBookingId, waId, {
      courtId: ctx.selectedCourtId!,
      dateKey: ctx.selectedDate!,
      bandStart: ctx.selectedBandStart!,
    })
    if (!moved) return { reply: RESCHEDULE_FAILED, state: BotState.MENU, ctx: keepName(ctx) }

    this.logger.log(`🔄 ${waId}: movió la reserva ${ctx.rescheduleBookingId}`)
    return {
      reply: rescheduleDone(ctx, moved.priceDiffCents, ctx.rescheduleCarriesDeposit),
      state: BotState.MENU,
      ctx: keepName(ctx),
    }
  }

  /**
   * The club answered this chat by hand from its WhatsApp Business app (a coexistence echo).
   * The owner is mid-conversation, so the bot steps aside for OWNER_REPLY_PAUSE_HOURS and then
   * takes the chat back on its own — unless staff took it over indefinitely from the panel.
   */
  async recordOwnerReply(waId: string, clubId: string, text: string): Promise<void> {
    const session = await this.sessionService.getOrCreate(waId, clubId)
    await this.sessionService.saveMessage(session.id, 'ADMIN', text)
    if (session.mode === 'HUMAN' && !session.humanUntil) return

    const until = new Date(Date.now() + ownerReplyPauseHours() * 60 * 60 * 1000)
    await this.sessionService.setMode(session.id, 'HUMAN', until)
    this.logger.log(`📱 ${waId}: el club respondió desde el celular, bot en pausa hasta ${until.toISOString()}`)
  }

  /**
   * Logs an exchange the bot's FSM didn't run — a tap on a template button, e.g. the fijo's
   * "Sí, voy" and its answer — so the club's chat view shows it like any other message. Doesn't
   * touch the session's state, mode or history.
   */
  async recordExchange(waId: string, clubId: string, playerText: string, botText: string): Promise<void> {
    const session = await this.sessionService.getOrCreate(waId, clubId)
    await this.sessionService.saveMessage(session.id, 'USER', playerText)
    await this.sessionService.saveMessage(session.id, 'BOT', botText)
  }

  /**
   * HUMAN guard shared by every inbound path. A temporary takeover (owner replied from the
   * phone) that already ran out flips back to AI here, so the bot answers this message.
   */
  private async isHumanHandled(session: SessionSnapshot, waId: string): Promise<boolean> {
    if (session.mode !== 'HUMAN') return false
    if (session.humanUntil && session.humanUntil.getTime() <= Date.now()) {
      await this.sessionService.setMode(session.id, 'AI')
      this.logger.log(`🤖 ${waId}: terminó la pausa por respuesta del club, el bot retoma`)
      return false
    }
    this.logger.log(`🙋 ${waId}: modo HUMANO, el bot no responde`)
    return true
  }

  /**
   * The player explicitly asked for a human. We silence the bot (mode → HUMAN), push the staff
   * so someone actually picks it up, and reassure the player — never leaving them talking to a
   * bot they asked to get past. The chat stays HUMAN until an admin flips it back from the panel.
   */
  private async handoffToHuman(sessionId: string, waId: string, clubId: string): Promise<BotReply> {
    await this.sessionService.setMode(sessionId, 'HUMAN')
    await this.notifications.notifyClub(clubId, {
      title: '🙋 Un jugador pide hablar con una persona',
      body: `Respondele desde Conversaciones (${waId}).`,
    })
    const reply = 'Dale 🙌 Aviso al equipo del club para que te atiendan por acá. En un ratito te responden. 🎾'
    await this.sessionService.saveMessage(sessionId, 'BOT', reply)
    this.logger.log(`🙋 ${waId}: derivado a humano por pedido explícito`)
    return { text: reply }
  }

  /** The player can't make any other day → the club takes it from here. */
  private async handOverToClub(clubId: string, waId: string, ctx: SessionContext): Promise<HandlerResult> {
    await this.askClubToHandle(clubId, waId, ctx.rescheduleFromLabel ?? 'un turno', 'no-day-works')
    return { reply: RESCHEDULE_NO_DAY_WORKS, state: BotState.MENU, ctx: keepName(ctx) }
  }

  /**
   * Puts the ball in the club's court: a push to the staff with who, which booking and why.
   * This is the escape hatch of the whole reschedule flow — every path that the bot can't
   * resolve on its own ends here, and none of them ends in silence.
   */
  private async askClubToHandle(clubId: string, waId: string, label: string, reason: string): Promise<void> {
    const why =
      reason === 'too-late'
        ? 'falta poco para el turno'
        : reason === 'limit-reached'
          ? 'ya lo movió una vez'
          : reason === 'no-day-works'
            ? 'no le sirve ningún otro día'
            : 'la política del club lo requiere'
    await this.notifications.notifyClub(clubId, {
      title: '🔄 Un jugador pide cambiar un turno',
      body: `${label} — ${why}. Respondele desde Conversaciones (${waId}).`,
    })
  }

  private async onBookDate(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    // "25/06", "hoy", "mañana", "el sábado"… all resolved here, for free. Only genuinely
    // ambiguous phrasing ("el finde largo", "para la semana del 20") reaches the LLM.
    const date = parseDateExpression(msg)
    if (!date) {
      return this.fallback(BotState.BOOK_DATE, msg, ctx, clubId, waId)
    }

    const bands = await this.availability.availableBandsForDate(clubId, date)
    if (bands.length === 0) {
      // Don't dead-end: offer the nearest days that do have availability and
      // stay in BOOK_DATE so the player can just reply with one of them.
      const suggestions = await this.availability.nextAvailableDates(clubId, date, { excludeDateKey: date })
      const offerWaitlist = await this.waitlist.offeredIn(clubId)
      return {
        reply: noAvailabilityWithSuggestions(date, suggestions, offerWaitlist),
        state: BotState.BOOK_DATE,
        ctx: { ...ctx, waitlistOfferDate: offerWaitlist ? date : undefined },
      }
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
      const offerWaitlist = await this.waitlist.offeredIn(clubId)
      return {
        reply: noAvailabilityWithSuggestions(nextCtx.selectedDate!, suggestions, offerWaitlist),
        state: BotState.BOOK_DATE,
        ctx: { ...nextCtx, waitlistOfferDate: offerWaitlist ? nextCtx.selectedDate : undefined },
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
      const offerWaitlist = await this.waitlist.offeredIn(clubId)
      return {
        reply: noAvailabilityWithSuggestions(ctx.selectedDate!, suggestions, offerWaitlist),
        state: BotState.BOOK_DATE,
        ctx: { ...ctx, waitlistOfferDate: offerWaitlist ? ctx.selectedDate : undefined },
      }
    }
    return availabilityResult(ctx, bands, ctx.selectedDate!)
  }

  private async onBookSlot(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const bands = ctx.dayAvailability ?? []

    // The player tapped a part of the day (offered when the free bands don't fit a list) →
    // narrow the botonera to that part's hours. The day's availability stays whole, so typing
    // "a las 10" after tapping "Tarde" still books the morning band instead of dead-ending.
    const part = parsePartOfDay(msg)
    if (part && bands.length) {
      const inPart = bandsInPart(bands, part)
      return {
        prefix: `Horarios de la *${PART_OF_DAY_NAMES[part]}* 👇`,
        reply: dayAvailabilityList(inPart, ctx.selectedDate!),
        state: BotState.BOOK_SLOT,
        ctx: { ...ctx, slotOptions: bandsToSlotOptions(inPart) },
      }
    }

    // Match against the WHOLE day, not just what's currently on the botonera.
    const slot = matchSlot(msg, bands.length ? bandsToSlotOptions(bands) : (ctx.slotOptions ?? []))
    if (slot) {
      // A real free band → auto-assign a court, or ask which one if several are free.
      return resolveBand(ctx, slot.bandStart)
    }

    // Anything the matcher couldn't place — an hour that isn't free, "el último", a court name,
    // a question — goes to the LLM, which reads the real availability with navigate_booking.
    // The canned "no me queda lugar" used to answer here, and it was confidently wrong whenever
    // the matcher misread the hour: it told a player 18:00 was taken while it sat there free.
    // Re-offer the whole day so the botonera isn't stuck on a part the player left.
    const withFullDay = bands.length ? { ...ctx, slotOptions: bandsToSlotOptions(bands) } : ctx
    return this.fallback(BotState.BOOK_SLOT, msg, withFullDay, clubId, waId)
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

    // A club that charges a seña must have a transfer alias configured before we lock a slot
    // the player can't actually pay for. A club on NONE charges nothing through the bot.
    const club = await this.bookingClubSettings(clubId)
    if (!club) {
      return { reply: PAYMENT_UNAVAILABLE, state: BotState.MENU, ctx: keepName(ctx) }
    }

    // Strict (AUTO) mode identifies the payer by DNI — but it never blocks the booking: we reuse
    // a DNI this phone already gave us, and otherwise the player can send their DNI or the
    // receipt photo later, while the deposit is pending (or neither: the club reviews it).
    // Without a seña there is no payer to identify.
    if (
      club.depositMode !== DepositMode.NONE &&
      club.requireDniMatch &&
      club.paymentVerificationMode !== 'RECEIPT' &&
      !ctx.playerDni
    ) {
      const knownDni = await this.bookingsService.findKnownDniForPhone(clubId, waId)
      if (knownDni) ctx = { ...ctx, playerDni: knownDni }
    }

    return this.createPendingBooking(clubId, waId, ctx, club)
  }

  private async onBookDni(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const dni = msg.replace(/\D/g, '')
    // The DNI is optional: someone else may pay, and the receipt photo identifies them.
    const skipped = dni.length === 0 && SKIP_DNI_INTENT.test(msg.trim())
    if (!skipped && (dni.length < 7 || dni.length > 8)) {
      return { reply: BAD_DNI, state: BotState.BOOK_DNI, ctx }
    }

    const club = await this.bookingClubSettings(clubId)
    if (!club) {
      return { reply: PAYMENT_UNAVAILABLE, state: BotState.MENU, ctx: keepName(ctx) }
    }

    return this.createPendingBooking(clubId, waId, skipped ? ctx : { ...ctx, playerDni: dni }, club)
  }

  /**
   * How the club charges, for the booking step — or null when it can't take a booking it would
   * have to charge for: a club that asks a seña (DEPOSIT/FULL) needs an alias to send the player
   * to. A club on NONE charges nothing through the bot, so it never needs one.
   */
  private async bookingClubSettings(clubId: string): Promise<BookingClubSettings | null> {
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
    if (!club || (club.depositMode !== DepositMode.NONE && !club.transferAlias)) return null
    return club
  }

  /**
   * Locks the slot for the player. With a seña, the booking is held PENDING and the player is told
   * exactly how much to transfer; with nothing to charge (club on NONE, or a $0 seña) it is
   * confirmed on the spot.
   */
  private async createPendingBooking(
    clubId: string,
    waId: string,
    ctx: SessionContext,
    club: BookingClubSettings,
  ): Promise<HandlerResult> {
    let pendingBooking: PendingBookingResult
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
    } catch (err) {
      // Too many no-shows and no seña to ask up front: a person of the club decides.
      if (err instanceof NoShowReviewRequiredException) {
        await this.notifications.notifyClub(clubId, {
          title: '🙋 Reserva para revisar',
          body:
            `${ctx.playerName} (${err.noShowCount} ausencias) pidió ${dayMonthFromKey(ctx.selectedDate!)} · ` +
            `${ctx.selectedSlotLabel} · ${ctx.selectedCourtName}. Respondele desde Conversaciones (${waId}).`,
        })
        return { reply: noShowReviewRequested(ctx), state: BotState.MENU, ctx: keepName(ctx) }
      }
      // A blocked player gets the club's message, not the generic "slot taken".
      if (err instanceof ForbiddenException) {
        return {
          reply: '😕 No puedo tomar reservas para este número por acá. Comunicate directamente con el club. 🙏',
          state: BotState.MENU,
          ctx: keepName(ctx),
        }
      }
      return { reply: BOOKING_FAILED, state: BotState.MENU, ctx: keepName(ctx) }
    }

    // Nothing to charge → confirmed on the spot: the bot just took the booking down.
    if (pendingBooking.confirmedWithoutDeposit) {
      return { reply: bookingConfirmedNoDeposit(ctx), state: BotState.MENU, ctx: keepName(ctx) }
    }

    // Credit covered the whole deposit → the booking is already CONFIRMED, no transfer needed.
    if (pendingBooking.confirmedByCredit) {
      const credit = (pendingBooking.creditAppliedCents / 100).toLocaleString('es-AR')
      return {
        reply:
          `✅ *¡Reserva confirmada!*\n\n` +
          `Usamos tu crédito a favor de $${credit} para cubrir la seña — no tenés que transferir nada. ¡Nos vemos en la cancha! 🎾`,
        state: BotState.MENU,
        ctx: keepName(ctx),
      }
    }

    return {
      reply: transferPending(
        ctx,
        // Non-null: a seña is only asked of a club with an alias (bookingClubSettings).
        { alias: club.transferAlias!, holder: club.transferHolder },
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

/** What the booking step reads about how the club charges. */
interface BookingClubSettings {
  transferAlias: string | null
  transferHolder: string | null
  depositMode: DepositMode
  requireDniMatch: boolean
  paymentVerificationMode: PaymentVerificationMode
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** One-line, length-capped version of a message for clean console logs. */
function logSnippet(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…'
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

/** Everything the bot said this turn: the prose answer (if any) plus the step's prompt. */
function fullReply(result: HandlerResult): string {
  return result.prefix ? `${result.prefix}\n\n${result.reply}` : result.reply
}

/**
 * Resolves which of the player's bookings a message refers to: the tapped row id
 * ("turno:<id>"), or — when they typed instead of tapping — the only booking whose day they
 * named. With several bookings on the same day we do NOT guess: cancelling the wrong court is
 * worse than asking again.
 */
function matchMyBooking(msg: string, bookings: MyBookingOption[]): MyBookingOption | undefined {
  const tapped = msg.trim().toLowerCase()
  if (tapped.startsWith(MY_BOOKING_PREFIX)) {
    const id = msg.trim().slice(MY_BOOKING_PREFIX.length)
    return bookings.find(b => b.id === id)
  }

  // Narrow by day first when the player named one, so "el del martes a las 21" doesn't collide
  // with a 21:00 booking on another day.
  const dateKey = parseDateExpression(msg)
  const sameDay = dateKey ? bookings.filter(b => b.short.startsWith(dayMonthFromKey(dateKey))) : bookings
  if (sameDay.length === 0) return undefined
  if (dateKey && sameDay.length === 1) return sameDay[0]

  // "moveme el de las 21" / "el de las nueve de la noche" — they told us which one; making them
  // tap a button to say it again is the bot failing to listen.
  const byTime = matchByTime(msg, sameDay, b => b.bandStart)
  if (byTime) {
    // Two courts in the same band: the hour alone doesn't say which, so let the LLM ask.
    const sameBand = sameDay.filter(b => b.bandStart === byTime.bandStart)
    return sameBand.length === 1 ? byTime : undefined
  }

  return undefined
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

/** Hours the bot stays quiet on a chat after the club answers it from the phone (default 6). */
function ownerReplyPauseHours(): number {
  const hours = Number(process.env.WHATSAPP_OWNER_REPLY_PAUSE_HOURS)
  return Number.isFinite(hours) && hours > 0 ? hours : 6
}

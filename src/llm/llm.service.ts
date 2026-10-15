import { Injectable, Logger } from '@nestjs/common'
import OpenAI, { APIError, toFile } from 'openai'
import { PrismaService } from '../prisma/prisma.service'
import { AvailabilityService } from '../availability/availability.service'
import { PlansService } from '../plans/plans.service'
import { todayKey } from '../availability/lib/datetime'
import { courtScheduleSelect } from '../availability/lib/schedule'
import { BotState, HandlerResult, SessionContext } from '../bot/types'
import { matchCourt, matchSlot } from '../bot/lib/match'
import { availabilityResult, bandsToSlotOptions, courtsFromBands, resolveBand } from '../bot/lib/booking-flow'
import { stepPrompt } from '../bot/lib/step-prompt'
import {
  ASK_DATE,
  ASK_NAME,
  DATE_OUT_OF_RANGE,
  NOT_UNDERSTOOD,
  TOO_MANY_MESSAGES,
  courtBusyAtTime,
  courtFullToday,
  noAvailabilityWithSuggestions,
  slotsList,
  timeNotAvailable,
} from '../bot/messages'
import { buildSystemPrompt, formatCurrentDate } from './system.prompt'
import { parseFaq } from '../clubs/clubs.service'
import { notifyOps } from '../common/ops-alert'
import { TOOLS } from './tools'

/** Per-user LLM call budget — protects against spam driving up OpenAI cost. */
const LLM_WINDOW_MS = 60_000
const LLM_MAX_CALLS_PER_WINDOW = Number(process.env.LLM_MAX_CALLS_PER_MIN) || 12

/**
 * OpenAI failures that belong to our account, not to one request: the prepaid credit ran out
 * (429 insufficient_quota) or the key is invalid/revoked (401). Every AI step then fails the same
 * way and the bot only degrades quietly, so ops must hear right away.
 */
type OpenAiAccountFailure = 'quota' | 'auth'
const OPENAI_ACCOUNT_ALERTS: Record<OpenAiAccountFailure, string> = {
  quota:
    '🚨 OpenAI rechazó la IA del bot por falta de saldo: cargá crédito en platform.openai.com (Billing) ' +
    'o activá la recarga automática.',
  auth:
    '🚨 OpenAI rechazó la clave de la IA del bot (inválida o revocada): generá una nueva en ' +
    'platform.openai.com (API keys), ponela en OPENAI_API_KEY del server y reiniciá la API.',
}
/** One ops alert per kind per hour: every AI step fails the same way until it's fixed. */
const OPENAI_ACCOUNT_ALERT_EVERY_MS = 60 * 60 * 1000

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name)
  private readonly openai: OpenAI
  /** waId → recent LLM-call timestamps (sliding window), for per-user rate limiting. */
  private readonly llmCalls = new Map<string, number[]>()
  /** Kind of OpenAI account failure → last ops alert. */
  private readonly accountAlerts = new Map<OpenAiAccountFailure, number>()
  /** Running OpenAI consumption since the process started (logged after every call). */
  private totalCalls = 0
  private totalTokens = 0
  private totalCostUsd = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly plans: PlansService,
  ) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  /**
   * Entry point called by BotService when deterministic parsing fails.
   * On any error, falls back gracefully to the main menu.
   */
  async handleFallback(
    state: BotState,
    message: string,
    ctx: SessionContext,
    clubId: string,
    waId: string,
  ): Promise<HandlerResult> {
    // Per-user budget: if exceeded, hold the player on their step instead of calling OpenAI.
    if (this.isRateLimited(waId)) {
      this.logger.warn(`LLM rate limit hit for ${waId}`)
      return this.inPlace(TOO_MANY_MESSAGES, state, ctx)
    }
    try {
      return await this.callOpenAI(state, message, ctx, clubId, waId)
    } catch (err) {
      this.logger.error('LLM fallback error', err)
      void this.alertAccountFailure(err)
      return this.inPlace(NOT_UNDERSTOOD, state, ctx)
    }
  }

  /**
   * Transcribes a player's voice note so it can go through the normal text flow. Returns null
   * when the audio can't be understood (or the per-player LLM budget is spent) — the caller
   * then asks the player to write instead.
   */
  async transcribeAudio(clubId: string, waId: string, bytes: Buffer, mimeType: string): Promise<string | null> {
    if (this.isRateLimited(waId)) return null
    const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe'
    try {
      const file = await toFile(bytes, `audio${audioExtension(mimeType)}`, { type: mimeType.split(';')[0] })
      const result = await this.openai.audio.transcriptions.create({ file, model, language: 'es' })
      void this.recordUsage(clubId, transcriptionUsage(result.usage))
      const text = result.text?.trim()
      this.logger.log(`🎤 Audio de ${waId} transcripto (${model}): ${logSnippet(text ?? '')}`)
      return text || null
    } catch (err) {
      this.logger.error(`Audio transcription failed for ${waId}`, err)
      void this.alertAccountFailure(err)
      return null
    }
  }

  /**
   * One-line description of an image a player sent outside a payment (a flyer, a screenshot of
   * a schedule, a photo of the court…), so the bot can answer it like a text message.
   */
  async describeImage(
    clubId: string,
    waId: string,
    bytes: Buffer,
    mimeType: string,
    caption?: string,
  ): Promise<string | null> {
    if (this.isRateLimited(waId)) return null
    const model = process.env.OPENAI_VISION_MODEL ?? chatModel()
    try {
      const completion = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Sos el asistente de WhatsApp de un club de pádel. Describí en UNA oración, en español, qué muestra ' +
              'la imagen y qué parece querer el jugador (por ejemplo: reservar un día/hora, una consulta, un ' +
              'comprobante de transferencia con su monto). Sin saludos ni opiniones.',
          },
          {
            role: 'user',
            content: [
              ...(caption ? [{ type: 'text' as const, text: `Texto que acompaña la imagen: ${caption}` }] : []),
              { type: 'image_url' as const, image_url: { url: `data:${mimeType};base64,${bytes.toString('base64')}` } },
            ],
          },
        ],
        ...generationParams(model, 200),
      })
      void this.recordUsage(clubId, completionUsage(model, completion.usage))
      const text = completion.choices[0]?.message?.content?.trim()
      this.logger.log(`🖼️  Imagen de ${waId} interpretada (${model}): ${logSnippet(text ?? '')}`)
      return text || null
    } catch (err) {
      this.logger.error(`Image description failed for ${waId}`, err)
      void this.alertAccountFailure(err)
      return null
    }
  }

  /**
   * Reads a bank/MercadoPago transfer receipt photo into structured fields. Used ONLY to
   * attribute a transfer to a booking (who paid, which operation): it never confirms anything
   * by itself — the money still has to show up in the club's MercadoPago. Returns null when
   * the image can't be read or isn't a receipt.
   */
  async readTransferReceipt(
    clubId: string,
    waId: string,
    bytes: Buffer,
    mimeType: string,
  ): Promise<ReceiptReading | null> {
    if (this.isRateLimited(waId)) return null
    const model = process.env.OPENAI_VISION_MODEL ?? chatModel()
    try {
      const completion = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Extraé los datos de un comprobante de transferencia bancaria o de MercadoPago (Argentina). ' +
              'Si la imagen no es un comprobante de transferencia, isTransferReceipt=false. No inventes datos: ' +
              'usá null en lo que no se lea con claridad. payerTaxId es el CUIT/CUIL/DNI de QUIEN ENVÍA el dinero ' +
              '(no el del destinatario), solo dígitos. amount es el importe transferido en pesos (número).',
          },
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${bytes.toString('base64')}` } }],
          },
        ],
        response_format: { type: 'json_schema', json_schema: RECEIPT_SCHEMA },
        ...generationParams(model, 300),
      })
      void this.recordUsage(clubId, completionUsage(model, completion.usage))
      const raw = completion.choices[0]?.message?.content
      const parsed = raw ? (JSON.parse(raw) as ReceiptReading) : null
      if (!parsed?.isTransferReceipt) return null
      this.logger.log(
        `🧾 Comprobante de ${waId}: monto=${parsed.amount ?? '?'} emisor=${parsed.payerTaxId ? '***' + parsed.payerTaxId.slice(-3) : '?'} op=${parsed.operationNumber ?? '?'}`,
      )
      return parsed
    } catch (err) {
      this.logger.error(`Receipt reading failed for ${waId}`, err)
      void this.alertAccountFailure(err)
      return null
    }
  }

  /**
   * Says something without moving the player: the answer (or apology) goes above the current
   * step's prompt, and the FSM stays where it was.
   *
   * This is the difference between a bot that survives a question and one that doesn't. An
   * OpenAI hiccup — or a player asking "¿es techada?" while staring at the booking summary —
   * used to reset the state to MENU, silently throwing away the booking they were one tap
   * from confirming. Only a step that can't be rebuilt falls back to the menu.
   */
  private inPlace(text: string, state: BotState, ctx: SessionContext): HandlerResult {
    const step = stepPrompt(state, ctx)
    if (!step) return { reply: text, state: BotState.MENU, ctx }
    return { prefix: text, reply: step, state, ctx }
  }

  /** Sliding-window check; records the call when allowed. Prunes idle users as it goes. */
  private isRateLimited(waId: string): boolean {
    const now = Date.now()
    const recent = (this.llmCalls.get(waId) ?? []).filter(t => now - t < LLM_WINDOW_MS)
    if (recent.length >= LLM_MAX_CALLS_PER_WINDOW) {
      this.llmCalls.set(waId, recent)
      return true
    }
    recent.push(now)
    this.llmCalls.set(waId, recent)
    // Opportunistically drop other users that have gone idle so the map stays small.
    if (this.llmCalls.size > 1000) {
      for (const [id, times] of this.llmCalls) {
        if (times.every(t => now - t >= LLM_WINDOW_MS)) this.llmCalls.delete(id)
      }
    }
    return false
  }

  /**
   * OpenAI refused because of our account (no credit, bad key): the player only sees "no
   * entendí" and audios/receipts stop being read until someone fixes it. Ops hears at once
   * (then hourly per kind while it lasts); never throws.
   */
  private async alertAccountFailure(err: unknown): Promise<void> {
    const failure = openAiAccountFailure(err)
    if (!failure) return
    const last = this.accountAlerts.get(failure) ?? 0
    if (Date.now() - last < OPENAI_ACCOUNT_ALERT_EVERY_MS) return
    this.accountAlerts.set(failure, Date.now())
    try {
      const { status, code } = err as APIError
      await notifyOps(
        `${OPENAI_ACCOUNT_ALERTS[failure]} Mientras tanto el bot no entiende mensajes fuera del menú, ` +
          `audios ni imágenes, comprobantes incluidos (OpenAI ${status}${code ? ` ${code}` : ''}).`,
      )
    } catch (alertErr) {
      this.logger.error('Could not alert ops about an OpenAI account failure', alertErr)
    }
  }

  // ── Core LLM call ──────────────────────────────────────────────────────────

  private async callOpenAI(
    state: BotState,
    message: string,
    ctx: SessionContext,
    clubId: string,
    waId: string,
  ): Promise<HandlerResult> {
    const [club, courts, products] = await Promise.all([
      // botFaq is the club's own Q&A so "¿alquilan paletas?", "¿hay estacionamiento?",
      // "¿puedo pagar en efectivo?" are answered from real config instead of "no lo tengo".
      this.prisma.club.findUnique({
        where: { id: clubId },
        select: { name: true, botFaq: true, depositMode: true, depositPercent: true },
      }),
      this.prisma.court.findMany({
        where: { clubId },
        // The real schedule, not just the names: the prompt describes THIS club's bands.
        select: { name: true, ...courtScheduleSelect },
        orderBy: { name: 'asc' },
      }),
      // Active products so the bot can quote paddle/ball rental, drinks, etc. by real price.
      this.prisma.product.findMany({
        where: { clubId, isActive: true },
        select: { name: true, priceCents: true },
        orderBy: { name: 'asc' },
      }),
    ])

    const systemPrompt = buildSystemPrompt({
      clubName: club?.name ?? 'el club',
      courts,
      currentDate: formatCurrentDate(),
      state,
      playerName: ctx.playerName,
      ctx,
      faq: parseFaq(club?.botFaq),
      products,
      payment: club ? { mode: club.depositMode, percent: club.depositPercent } : undefined,
    })

    const historyMessages: OpenAI.ChatCompletionMessageParam[] = (ctx.history ?? []).map(m => ({
      role: m.role,
      content: m.content,
    }))

    const model = chatModel()
    const completion = await this.openai.chat.completions.create({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...historyMessages, { role: 'user', content: message }],
      tools: TOOLS,
      tool_choice: 'auto',
      ...generationParams(model, 400, { withTools: true }),
    })

    const { usage } = completion
    if (usage) {
      const cost = estimateCost(model, usage.prompt_tokens, usage.completion_tokens)
      this.totalCalls++
      this.totalTokens += usage.total_tokens
      this.totalCostUsd += cost
      this.logger.log(
        `🤖 OpenAI — model=${model} waId=${waId} ` +
          `in=${usage.prompt_tokens} out=${usage.completion_tokens} total=${usage.total_tokens} costo=$${cost.toFixed(6)} ` +
          `| acumulado: ${this.totalCalls} llamadas · ${this.totalTokens} tokens · $${this.totalCostUsd.toFixed(4)}`,
      )
      // The counters above die with the process. This is the copy that survives, and the
      // only way to know what a club actually costs us.
      void this.recordUsage(clubId, {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        costUsd: cost,
      })
    }

    const choice = completion.choices[0]

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      const call = choice.message.tool_calls[0]
      if (call.type === 'function') {
        this.logger.log(`LLM tool call: ${call.function.name} — args: ${call.function.arguments}`)
        return this.dispatchToolCall(call.function.name, call.function.arguments, state, ctx, clubId)
      }
    }

    // No tool call → the LLM answered a question (price, courts, "¿es techada?"). Say it and
    // keep the player exactly where they were.
    const text = choice.message.content?.trim()
    if (!text) return this.inPlace(NOT_UNDERSTOOD, state, ctx)

    // Surface "no lo tengo"-type answers: they're the fastest signal of what players ask that
    // the club's FAQ doesn't cover yet. Greppable so it can feed the FAQ (see BOT_AUDIT).
    if (isNoAnswerReply(text)) {
      this.logger.warn(`🤷 LLM sin dato — club=${clubId} pregunta="${logSnippet(message)}"`)
    }

    this.logger.log(`LLM text reply (state=${state})`)
    return this.inPlace(text, state, ctx)
  }

  // ── Tool dispatcher ────────────────────────────────────────────────────────

  private dispatchToolCall(
    name: string,
    argsJson: string,
    state: BotState,
    ctx: SessionContext,
    clubId: string,
  ): Promise<HandlerResult> {
    let args: BookingToolArgs
    try {
      args = JSON.parse(argsJson) as BookingToolArgs
    } catch {
      this.logger.error(`LLM returned unparseable tool args: ${argsJson}`)
      return Promise.resolve(this.inPlace(NOT_UNDERSTOOD, state, ctx))
    }

    switch (name) {
      case 'navigate_booking':
        return this.handleNavigateBooking(args, state, ctx, clubId)
      default:
        this.logger.error(`LLM called an unknown tool: ${name}`)
        return Promise.resolve(this.inPlace(NOT_UNDERSTOOD, state, ctx))
    }
  }

  // ── Tool handlers ──────────────────────────────────────────────────────────

  private async handleNavigateBooking(
    args: BookingToolArgs,
    state: BotState,
    ctx: SessionContext,
    clubId: string,
  ): Promise<HandlerResult> {
    // No date extracted → ask for it
    if (!args.date) {
      return { reply: ASK_DATE, state: BotState.BOOK_DATE, ctx }
    }

    // The date comes from a language model: it can be malformed ("2026-13-45"), in the past,
    // or years away. Feeding any of those to availability yields empty grids and "undefined
    // NaN/NaN" in the player's message, so it never gets past here unchecked.
    const date = validBookingDate(args.date)
    if (!date) {
      this.logger.warn(`LLM proposed an unusable date: ${args.date}`)
      return { prefix: DATE_OUT_OF_RANGE, reply: ASK_DATE, state: BotState.BOOK_DATE, ctx }
    }

    const bands = await this.availability.availableBandsForDate(clubId, date)
    if (bands.length === 0) {
      // Proactively offer the nearest days with availability instead of dead-ending.
      const suggestions = await this.availability.nextAvailableDates(clubId, date, { excludeDateKey: date })
      const offerWaitlist = await this.plans.hasFeature(clubId, 'waitlist')
      return {
        reply: noAvailabilityWithSuggestions(date, suggestions, offerWaitlist),
        state: BotState.BOOK_DATE,
        ctx: { ...ctx, waitlistOfferDate: offerWaitlist ? date : undefined },
      }
    }

    const needsName = !ctx.playerName
    const base: SessionContext = {
      ...ctx,
      selectedDate: date,
      dayAvailability: bands,
      slotOptions: bandsToSlotOptions(bands),
    }

    // Explicit court mentioned → keep it time-first, but narrowed to that one court.
    const matchedCourt = args.courtName ? matchCourt(args.courtName, courtsFromBands(bands)) : undefined
    if (matchedCourt) {
      const courtBands = bands
        .filter(b => b.courts.some(c => c.id === matchedCourt.id))
        .map(b => ({ ...b, courts: b.courts.filter(c => c.id === matchedCourt.id) }))

      if (courtBands.length === 0) {
        // The requested court is fully booked today → say so plainly (don't silently switch
        // courts) and show what's free across the club.
        if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: base }
        return { reply: courtFullToday(matchedCourt.name, bands, date), state: BotState.BOOK_SLOT, ctx: base }
      }

      const courtCtx: SessionContext = {
        ...base,
        dayAvailability: courtBands,
        slotOptions: bandsToSlotOptions(courtBands),
        selectedCourtId: matchedCourt.id,
        selectedCourtName: matchedCourt.name,
      }

      const matchedSlot = args.timePreference ? matchSlot(args.timePreference, courtCtx.slotOptions!) : undefined
      if (matchedSlot) {
        if (needsName) {
          return {
            reply: ASK_NAME,
            state: BotState.BOOK_NAME,
            ctx: { ...courtCtx, selectedBandStart: matchedSlot.bandStart, selectedSlotLabel: matchedSlot.label },
          }
        }
        return resolveBand(courtCtx, matchedSlot.bandStart)
      }

      // The player asked for this court at a time that's taken there → tell them it's busy at
      // that time (instead of assuming another court) and show its other free turns.
      if (args.timePreference) {
        if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: courtCtx }
        return {
          reply: courtBusyAtTime(matchedCourt.name, courtCtx.slotOptions!, date),
          state: BotState.BOOK_SLOT,
          ctx: courtCtx,
        }
      }

      if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: courtCtx }
      return {
        reply: slotsList(courtCtx.slotOptions!, matchedCourt.name, date),
        state: BotState.BOOK_SLOT,
        ctx: courtCtx,
      }
    }

    // No court, but a time was given → assign a court (or ask if several are free).
    if (args.timePreference) {
      const matchedSlot = matchSlot(args.timePreference, base.slotOptions!)
      if (matchedSlot) {
        if (needsName) {
          const band = bands.find(b => b.bandStart === matchedSlot.bandStart)!
          return {
            reply: ASK_NAME,
            state: BotState.BOOK_NAME,
            ctx: { ...base, selectedBandStart: matchedSlot.bandStart, selectedSlotLabel: band.label },
          }
        }
        return resolveBand(base, matchedSlot.bandStart)
      }
      // Time not free → show what is.
      if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: base }
      return { reply: timeNotAvailable(bands, date), state: BotState.BOOK_SLOT, ctx: base }
    }

    // No court, no time → show the day's availability grouped by court.
    if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: base }
    return availabilityResult(ctx, bands, date)
  }

  // ── Cost accounting ─────────────────────────────────────────────────────────

  /**
   * Rolls one AI step (understanding a message, transcribing an audio, reading an image) into
   * the club's daily total: one call plus its tokens and estimated cost, read by the ops console
   * (OpenAI cost, profitability). Not the club's credits — those count WhatsApp messages.
   *
   * Fire-and-forget and never throws: the player is waiting on a WhatsApp reply, and our
   * accounting is not worth failing their booking over. A dropped row costs us a fraction
   * of a cent of visibility; a thrown error costs a customer.
   */
  private async recordUsage(clubId: string, { inputTokens, outputTokens, costUsd }: StepUsage): Promise<void> {
    const dateKey = todayKey()
    const costMicroUsd = Math.round(costUsd * 1_000_000)

    try {
      await this.prisma.llmUsageDaily.upsert({
        where: { clubId_dateKey: { clubId, dateKey } },
        create: { clubId, dateKey, calls: 1, inputTokens, outputTokens, costMicroUsd },
        update: {
          calls: { increment: 1 },
          inputTokens: { increment: inputTokens },
          outputTokens: { increment: outputTokens },
          costMicroUsd: { increment: costMicroUsd },
        },
      })
    } catch (error) {
      this.logger.error(`Failed to record LLM usage for club ${clubId}`, error)
    }
  }
}

// ── Types & pure helpers ─────────────────────────────────────────────────────

/** Prices in USD per 1 M tokens (input / output). Updated June 2025. */
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
}

/** The chat model the bot talks with (OPENAI_MODEL, e.g. "gpt-6-luna"). */
function chatModel(): string {
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
}

/**
 * Sampling/length params differ by model generation: the gpt-4o/3.5 family takes
 * `temperature` + `max_tokens`, while the newer reasoning models (gpt-5.x, gpt-6-luna…) reject
 * both — they need `max_completion_tokens` (which also budgets their hidden reasoning, hence
 * the headroom) and accept `reasoning_effort` (OPENAI_REASONING_EFFORT, default "low", used for
 * calls without tools such as reading an image).
 */
function generationParams(model: string, maxOutputTokens: number, opts: { withTools?: boolean } = {}) {
  if (/^gpt-(4|3\.5)/.test(model)) return { temperature: 0.3, max_tokens: maxOutputTokens }
  // Chat Completions rejects function tools combined with any reasoning effort but "none" on
  // these models (only the Responses API allows both), so a tool call always runs at "none".
  const effort = (opts.withTools ? 'none' : (process.env.OPENAI_REASONING_EFFORT ?? 'low')) as OpenAI.ReasoningEffort
  return { max_completion_tokens: maxOutputTokens * 4, reasoning_effort: effort }
}

function audioExtension(mimeType: string): string {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return '.mp3'
  if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) return '.m4a'
  if (mimeType.includes('wav')) return '.wav'
  return '.ogg' // WhatsApp voice notes: audio/ogg; codecs=opus
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const override = modelPriceOverride()
  const prices = override ?? MODEL_PRICES[model] ?? MODEL_PRICES['gpt-4o-mini']
  return (inputTokens * prices.input + outputTokens * prices.output) / 1_000_000
}

/** Tokens and estimated cost of one AI step. */
interface StepUsage {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/** A chat completion (text or image) as a step; no usage reported → counted, priced at $0. */
function completionUsage(model: string, usage: OpenAI.CompletionUsage | undefined): StepUsage {
  if (!usage) return { inputTokens: 0, outputTokens: 0, costUsd: 0 }
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    costUsd: estimateCost(model, usage.prompt_tokens, usage.completion_tokens),
  }
}

/**
 * Transcription list prices (gpt-4o-mini-transcribe): USD per 1M audio-input / text-output
 * tokens, or per minute when the API reports a duration. Only the ops cost column reads them —
 * the credit counts the step, whatever it costs.
 */
const TRANSCRIBE_PRICES = { input: 3, output: 5, perMinute: 0.003 }

function transcriptionUsage(usage: OpenAI.Audio.Transcription['usage']): StepUsage {
  if (usage?.type === 'tokens') {
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costUsd:
        (usage.input_tokens * TRANSCRIBE_PRICES.input + usage.output_tokens * TRANSCRIBE_PRICES.output) / 1_000_000,
    }
  }
  const seconds = usage?.type === 'duration' ? usage.seconds : 0
  return { inputTokens: 0, outputTokens: 0, costUsd: (seconds / 60) * TRANSCRIBE_PRICES.perMinute }
}

/**
 * Which account-level failure an OpenAI error is, if any. A plain 429 (rate_limit_exceeded) or a
 * 5xx passes on its own and isn't ours to fix, so it stays a log line.
 */
function openAiAccountFailure(err: unknown): OpenAiAccountFailure | null {
  if (!(err instanceof APIError)) return null
  if (err.status === 429 && err.code === 'insufficient_quota') return 'quota'
  if (err.status === 401) return 'auth'
  return null
}

/** One-line, length-capped version of a message for clean console logs. */
function logSnippet(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…'
}

/**
 * True when the LLM's reply is a "I don't have that info" answer. Heuristic on purpose — it
 * only drives a log line (never the player's experience), so a few false positives/negatives
 * are fine. Diacritics stripped so "sé"/"información" match the accent-free stems.
 */
function isNoAnswerReply(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  return /no (lo )?(se|tengo|cuento con|dispongo)|no (tengo|cuento con) (esa|esta|la) (info|informacion|dato)|no estoy seguro|consultalo con el club|escribile al club|preguntale al club/.test(
    t,
  )
}

interface BookingToolArgs {
  date?: string
  courtName?: string
  timePreference?: string
}

/** How far ahead a booking may be made — beyond this, the LLM hallucinated a year. */
const MAX_BOOKING_HORIZON_DAYS = 120

/**
 * Validates a date proposed by the LLM: a real "YYYY-MM-DD" calendar day, today or later in
 * the club's timezone, and inside the booking horizon. Returns the key, or null to re-ask.
 *
 * Nothing downstream re-checks this: an unusable date reaches availability as an empty grid
 * and the player as "undefined NaN/NaN".
 */
export function validBookingDate(raw: string, today: string = todayKey()): string | null {
  const key = raw.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null

  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // Rejects impossible days the regex happily accepts (2026-02-31, 2026-13-01…).
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null

  // Lexicographic comparison is date order for YYYY-MM-DD.
  if (key < today) return null

  const [ty, tm, td] = today.split('-').map(Number)
  const daysAhead = (probe.getTime() - Date.UTC(ty, tm - 1, td)) / 86_400_000
  return daysAhead <= MAX_BOOKING_HORIZON_DAYS ? key : null
}

/**
 * USD per 1M tokens for a model missing from MODEL_PRICES (e.g. a model newer than this table):
 * OPENAI_PRICE_INPUT_PER_MTOK / OPENAI_PRICE_OUTPUT_PER_MTOK. Without it the cost log falls back
 * to gpt-4o-mini prices, which would under-report a pricier model.
 */
function modelPriceOverride(): { input: number; output: number } | null {
  const input = Number(process.env.OPENAI_PRICE_INPUT_PER_MTOK)
  const output = Number(process.env.OPENAI_PRICE_OUTPUT_PER_MTOK)
  return Number.isFinite(input) && Number.isFinite(output) && input > 0 ? { input, output } : null
}

/** The chat model and what it costs per million tokens (USD), as the cost log prices it. */
export function chatModelPricing(): { model: string; inputPerMTok: number; outputPerMTok: number } {
  const model = chatModel()
  const prices = modelPriceOverride() ?? MODEL_PRICES[model] ?? MODEL_PRICES['gpt-4o-mini']
  return { model, inputPerMTok: prices.input, outputPerMTok: prices.output }
}

/** What a transfer receipt photo says. Every field may be null when it isn't legible. */
export interface ReceiptReading {
  isTransferReceipt: boolean
  amount: number | null
  payerName: string | null
  payerTaxId: string | null
  operationNumber: string | null
  destination: string | null
}

const RECEIPT_SCHEMA = {
  name: 'transfer_receipt',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['isTransferReceipt', 'amount', 'payerName', 'payerTaxId', 'operationNumber', 'destination'],
    properties: {
      isTransferReceipt: { type: 'boolean' },
      amount: { type: ['number', 'null'] },
      payerName: { type: ['string', 'null'] },
      payerTaxId: { type: ['string', 'null'] },
      operationNumber: { type: ['string', 'null'] },
      destination: { type: ['string', 'null'] },
    },
  },
}

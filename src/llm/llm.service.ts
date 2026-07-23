import { Injectable, Logger } from '@nestjs/common'
import OpenAI from 'openai'
import { PrismaService } from '../prisma/prisma.service'
import { AvailabilityService } from '../availability/availability.service'
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
import { TOOLS } from './tools'

/** Per-user LLM call budget — protects against spam driving up OpenAI cost. */
const LLM_WINDOW_MS = 60_000
const LLM_MAX_CALLS_PER_WINDOW = Number(process.env.LLM_MAX_CALLS_PER_MIN) || 12

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name)
  private readonly openai: OpenAI
  /** waId → recent LLM-call timestamps (sliding window), for per-user rate limiting. */
  private readonly llmCalls = new Map<string, number[]>()
  /** Running OpenAI consumption since the process started (logged after every call). */
  private totalCalls = 0
  private totalTokens = 0
  private totalCostUsd = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
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
      return this.inPlace(NOT_UNDERSTOOD, state, ctx)
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
      this.prisma.club.findUnique({ where: { id: clubId }, select: { name: true, botFaq: true } }),
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
    })

    const historyMessages: OpenAI.ChatCompletionMessageParam[] = (ctx.history ?? []).map(m => ({
      role: m.role,
      content: m.content,
    }))

    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
    const completion = await this.openai.chat.completions.create({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...historyMessages, { role: 'user', content: message }],
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
      max_tokens: 400,
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
      void this.recordUsage(clubId, usage.prompt_tokens, usage.completion_tokens, cost)
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
      return {
        reply: noAvailabilityWithSuggestions(date, suggestions),
        state: BotState.BOOK_DATE,
        ctx: { ...ctx, waitlistOfferDate: date },
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
   * Rolls this call into the club's daily OpenAI total (read by the ops console).
   *
   * Fire-and-forget and never throws: the player is waiting on a WhatsApp reply, and our
   * accounting is not worth failing their booking over. A dropped row costs us a fraction
   * of a cent of visibility; a thrown error costs a customer.
   */
  private async recordUsage(clubId: string, inputTokens: number, outputTokens: number, costUsd: number): Promise<void> {
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

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const prices = MODEL_PRICES[model] ?? MODEL_PRICES['gpt-4o-mini']
  return (inputTokens * prices.input + outputTokens * prices.output) / 1_000_000
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

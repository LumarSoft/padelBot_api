import { Injectable, Logger } from '@nestjs/common'
import OpenAI from 'openai'
import { PrismaService } from '../prisma/prisma.service'
import { AvailabilityService } from '../availability/availability.service'
import { BotState, HandlerResult, SessionContext } from '../bot/types'
import { matchCourt, matchSlot } from '../bot/lib/match'
import { availabilityResult, bandsToSlotOptions, courtsFromBands, resolveBand } from '../bot/lib/booking-flow'
import {
  ASK_DATE,
  ASK_NAME,
  MENU,
  courtBusyAtTime,
  courtFullToday,
  noAvailabilityWithSuggestions,
  slotsList,
  timeNotAvailable,
} from '../bot/messages'
import { buildSystemPrompt, formatCurrentDate } from './system.prompt'
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
    // Per-user budget: if exceeded, steer back to the menu instead of calling OpenAI.
    if (this.isRateLimited(waId)) {
      this.logger.warn(`LLM rate limit hit for ${waId}`)
      return { reply: MENU, state: BotState.MENU, ctx }
    }
    try {
      return await this.callOpenAI(state, message, ctx, clubId, waId)
    } catch (err) {
      this.logger.error('LLM fallback error', err)
      return { reply: MENU, state: BotState.MENU, ctx }
    }
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
    const [club, courts] = await Promise.all([
      this.prisma.club.findUnique({ where: { id: clubId }, select: { name: true } }),
      this.prisma.court.findMany({ where: { clubId }, select: { name: true }, orderBy: { name: 'asc' } }),
    ])

    const systemPrompt = buildSystemPrompt({
      clubName: club?.name ?? 'el club',
      courtNames: courts.map(c => c.name),
      currentDate: formatCurrentDate(),
      state,
      playerName: ctx.playerName,
      ctx,
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
    }

    const choice = completion.choices[0]

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      const call = choice.message.tool_calls[0]
      if (call.type === 'function') {
        this.logger.log(`LLM tool call: ${call.function.name} — args: ${call.function.arguments}`)
        return this.dispatchToolCall(call.function.name, call.function.arguments, ctx, clubId)
      }
    }

    // No tool call → text response (general question, clarification, etc.)
    const text = choice.message.content?.trim()
    if (!text) return { reply: MENU, state: BotState.MENU, ctx }

    this.logger.log(`LLM text reply (state=${state})`)
    return { reply: text, state: BotState.MENU, ctx }
  }

  // ── Tool dispatcher ────────────────────────────────────────────────────────

  private dispatchToolCall(
    name: string,
    argsJson: string,
    ctx: SessionContext,
    clubId: string,
  ): Promise<HandlerResult> {
    const args = JSON.parse(argsJson) as BookingToolArgs
    switch (name) {
      case 'navigate_booking':
        return this.handleNavigateBooking(args, ctx, clubId)
      default:
        return Promise.resolve({ reply: MENU, state: BotState.MENU, ctx })
    }
  }

  // ── Tool handlers ──────────────────────────────────────────────────────────

  private async handleNavigateBooking(
    args: BookingToolArgs,
    ctx: SessionContext,
    clubId: string,
  ): Promise<HandlerResult> {
    // No date extracted → ask for it
    if (!args.date) {
      return { reply: ASK_DATE, state: BotState.BOOK_DATE, ctx }
    }

    const bands = await this.availability.availableBandsForDate(clubId, args.date)
    if (bands.length === 0) {
      // Proactively offer the nearest days with availability instead of dead-ending.
      const suggestions = await this.availability.nextAvailableDates(clubId, args.date, { excludeDateKey: args.date })
      return {
        reply: noAvailabilityWithSuggestions(args.date, suggestions),
        state: BotState.BOOK_DATE,
        ctx: { ...ctx, waitlistOfferDate: args.date },
      }
    }

    const needsName = !ctx.playerName
    const base: SessionContext = {
      ...ctx,
      selectedDate: args.date,
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
        return { reply: courtFullToday(matchedCourt.name, bands, args.date), state: BotState.BOOK_SLOT, ctx: base }
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
          reply: courtBusyAtTime(matchedCourt.name, courtCtx.slotOptions!, args.date),
          state: BotState.BOOK_SLOT,
          ctx: courtCtx,
        }
      }

      if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: courtCtx }
      return {
        reply: slotsList(courtCtx.slotOptions!, matchedCourt.name, args.date),
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
      return { reply: timeNotAvailable(bands, args.date), state: BotState.BOOK_SLOT, ctx: base }
    }

    // No court, no time → show the day's availability grouped by court.
    if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: base }
    return availabilityResult(ctx, bands, args.date)
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

interface BookingToolArgs {
  date?: string
  courtName?: string
  timePreference?: string
}

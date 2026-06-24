import { Injectable, Logger } from '@nestjs/common'
import OpenAI from 'openai'
import { PrismaService } from '../prisma/prisma.service'
import { AvailabilityService } from '../availability/availability.service'
import { formatTimeRange, toDateKey } from '../availability/lib/datetime'
import { BotState, CourtOption, HandlerResult, SessionContext, SlotOption } from '../bot/types'
import { matchCourt, matchSlot } from '../bot/lib/match'
import {
  ASK_DATE,
  ASK_NAME,
  MENU,
  NO_BOOKINGS,
  cancelList,
  confirmBooking,
  courtsAtTimeList,
  courtsList,
  myBookingsList,
  noAvailabilityWithSuggestions,
  slotsList,
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
      this.logger.log(
        `LLM usage — model=${model} waId=${waId} ` +
          `in=${usage.prompt_tokens} out=${usage.completion_tokens} total=${usage.total_tokens} ` +
          `est_cost=$${cost.toFixed(6)}`,
      )
    }

    const choice = completion.choices[0]

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      const call = choice.message.tool_calls[0]
      if (call.type === 'function') {
        this.logger.log(`LLM tool call: ${call.function.name} — args: ${call.function.arguments}`)
        return this.dispatchToolCall(call.function.name, call.function.arguments, ctx, clubId, waId)
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
    waId: string,
  ): Promise<HandlerResult> {
    const args = JSON.parse(argsJson) as BookingToolArgs
    switch (name) {
      case 'navigate_booking':
        return this.handleNavigateBooking(args, ctx, clubId)
      case 'navigate_my_bookings':
        return this.handleNavigateMyBookings(ctx, clubId, waId)
      case 'navigate_cancel':
        return this.handleNavigateCancel(ctx, clubId, waId)
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

    const courts = await this.availability.courtsForDate(clubId, args.date)
    if (courts.length === 0) {
      // Proactively offer the nearest days with availability instead of dead-ending.
      const suggestions = await this.availability.nextAvailableDates(clubId, args.date, { excludeDateKey: args.date })
      return { reply: noAvailabilityWithSuggestions(args.date, suggestions), state: BotState.BOOK_DATE, ctx }
    }

    const nextCtx: SessionContext = { ...ctx, selectedDate: args.date, courtOptions: courts }
    const needsName = !ctx.playerName

    // Try to match court name from LLM extraction
    const matchedCourt = args.courtName ? matchCourt(args.courtName, courts) : undefined

    if (matchedCourt) {
      const slots = await this.availability.slotsForDate(clubId, args.date, matchedCourt.id)

      if (slots.length === 0) {
        const fallbackMsg = `😕 No hay turnos disponibles en *${matchedCourt.name}* para esa fecha. Elegí otra cancha:\n\n${courtsList(courts, args.date)}`
        return { reply: fallbackMsg, state: BotState.BOOK_COURT, ctx: nextCtx }
      }

      const ctxWithCourt: SessionContext = {
        ...nextCtx,
        selectedCourtId: matchedCourt.id,
        selectedCourtName: matchedCourt.name,
        slotOptions: slots,
      }

      // Try to match time preference
      const matchedSlot = args.timePreference ? matchSlot(args.timePreference, slots) : undefined

      if (matchedSlot) {
        const ctxWithSlot: SessionContext = {
          ...ctxWithCourt,
          selectedSlotId: matchedSlot.slotId,
          selectedBandStart: matchedSlot.bandStart,
          selectedSlotLabel: matchedSlot.label,
          selectedSlotPrice: matchedSlot.price,
        }
        if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: ctxWithSlot }
        return { reply: confirmBooking(ctxWithSlot), state: BotState.BOOK_CONFIRM, ctx: ctxWithSlot }
      }

      if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: ctxWithCourt }
      return { reply: slotsList(slots, matchedCourt.name, args.date), state: BotState.BOOK_SLOT, ctx: ctxWithCourt }
    }

    // No court chosen, but the player gave a time → tell them which courts are free at
    // that exact time so they confirm in one step instead of picking a court blindly.
    if (args.timePreference) {
      const atTime = await this.courtsFreeAtTime(clubId, args.date, args.timePreference, courts)

      if (atTime.length === 1) {
        const { court, slot } = atTime[0]
        const ctxSel: SessionContext = {
          ...nextCtx,
          selectedCourtId: court.id,
          selectedCourtName: court.name,
          slotOptions: [slot],
          selectedSlotId: slot.slotId,
          selectedBandStart: slot.bandStart,
          selectedSlotLabel: slot.label,
          selectedSlotPrice: slot.price,
        }
        if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: ctxSel }
        return { reply: confirmBooking(ctxSel), state: BotState.BOOK_CONFIRM, ctx: ctxSel }
      }

      if (atTime.length > 1) {
        // Remember the chosen time band; when they pick a court, onBookCourt resolves
        // that band directly and jumps to confirmation.
        const courtOptions = atTime.map(a => a.court)
        const { bandStart, label } = atTime[0].slot
        const ctxMulti: SessionContext = {
          ...nextCtx,
          courtOptions,
          selectedBandStart: bandStart,
          selectedSlotLabel: label,
        }
        if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: ctxMulti }
        return { reply: courtsAtTimeList(courtOptions, label, args.date), state: BotState.BOOK_COURT, ctx: ctxMulti }
      }
      // Nobody free at that time → fall through to the day's court list.
    }

    // Court not matched or not provided → show court list
    if (needsName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: nextCtx }
    return { reply: courtsList(courts, args.date), state: BotState.BOOK_COURT, ctx: nextCtx }
  }

  /** Courts (from `courts`) that have a free slot matching the time phrasing, with that slot. */
  private async courtsFreeAtTime(
    clubId: string,
    dateKey: string,
    timePreference: string,
    courts: CourtOption[],
  ): Promise<{ court: CourtOption; slot: SlotOption }[]> {
    const result: { court: CourtOption; slot: SlotOption }[] = []
    for (const court of courts) {
      const slots = await this.availability.slotsForDate(clubId, dateKey, court.id)
      const slot = matchSlot(timePreference, slots)
      if (slot) result.push({ court, slot })
    }
    return result
  }

  private async handleNavigateMyBookings(ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const bookings = await this.fetchUserBookings(clubId, waId)
    if (bookings.length === 0) return { reply: NO_BOOKINGS, state: BotState.MENU, ctx }
    const options = bookings.map(b => ({ id: b.id, label: buildBookingLabel(b) }))
    return { reply: myBookingsList(options), state: BotState.MENU, ctx }
  }

  private async handleNavigateCancel(ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const bookings = await this.fetchUserBookings(clubId, waId)
    if (bookings.length === 0) return { reply: NO_BOOKINGS, state: BotState.MENU, ctx }
    const options = bookings.map(b => ({ id: b.id, label: buildBookingLabel(b) }))
    return { reply: cancelList(options), state: BotState.CANCEL_SELECT, ctx: { ...ctx, bookingOptions: options } }
  }

  // ── DB helpers ─────────────────────────────────────────────────────────────

  private fetchUserBookings(clubId: string, waId: string) {
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

// ── Types & pure helpers ─────────────────────────────────────────────────────

/** Prices in USD per 1 M tokens (input / output). Updated June 2025. */
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':          { input: 0.15,  output: 0.60  },
  'gpt-4o':               { input: 2.50,  output: 10.00 },
  'gpt-4-turbo':          { input: 10.00, output: 30.00 },
  'gpt-4':                { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo':        { input: 0.50,  output: 1.50  },
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

function buildBookingLabel(b: { slot: { startsAt: Date; endsAt: Date; court: { name: string } } }): string {
  const { startsAt, endsAt } = b.slot
  const [, m, d] = toDateKey(startsAt).split('-')
  return `${d}/${m} · ${b.slot.court.name} · ${formatTimeRange(startsAt, endsAt)}`
}

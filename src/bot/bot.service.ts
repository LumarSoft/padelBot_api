import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { BookingsService } from '../bookings/bookings.service'
import { ConversationSessionService, keepName } from './conversation-session.service'
import { BotState, BookingOption, CourtOption, HandlerResult, SessionContext, SlotOption } from './types'
import {
  ASK_DATE,
  ASK_NAME,
  BAD_BOOKING,
  BAD_COURT,
  BAD_DATE,
  BAD_OPTION,
  BAD_SLOT,
  BOOKING_ABORTED,
  BOOKING_FAILED,
  CANCEL_ABORTED,
  CANCEL_CONFIRMED,
  CANCEL_FAILED,
  MENU,
  NO_BOOKINGS,
  NO_SLOTS,
  WELCOME,
  bookingConfirmed,
  cancelList,
  confirmBooking,
  confirmCancel,
  courtsList,
  myBookingsList,
  noCourts,
  slotsList,
} from './messages'

@Injectable()
export class BotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly sessionService: ConversationSessionService,
  ) {}

  async handleMessage(waId: string, clubId: string, body: string): Promise<string> {
    const session = await this.sessionService.getOrCreate(waId, clubId)
    const msg = body.trim()

    const { reply, state, ctx } = await this.dispatch(session.state as BotState, msg, session.context, clubId, waId)
    await this.sessionService.update(session.id, state, ctx)
    return reply
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
        return Promise.resolve(this.onIdle(ctx))
      case BotState.MENU:
        return this.onMenu(msg, ctx, clubId, waId)
      case BotState.BOOK_DATE:
        return this.onBookDate(msg, ctx, clubId)
      case BotState.BOOK_NAME:
        return this.onBookName(msg, ctx, clubId)
      case BotState.BOOK_COURT:
        return this.onBookCourt(msg, ctx, clubId)
      case BotState.BOOK_SLOT:
        return Promise.resolve(this.onBookSlot(msg, ctx))
      case BotState.BOOK_CONFIRM:
        return this.onBookConfirm(msg, ctx, clubId, waId)
      case BotState.CANCEL_SELECT:
        return Promise.resolve(this.onCancelSelect(msg, ctx))
      case BotState.CANCEL_CONFIRM:
        return this.onCancelConfirm(msg, ctx, clubId)
      default:
        return Promise.resolve({ reply: WELCOME, state: BotState.MENU, ctx })
    }
  }

  // ── State handlers ─────────────────────────────────────────────────────────

  private onIdle(ctx: SessionContext): HandlerResult {
    return { reply: WELCOME, state: BotState.MENU, ctx }
  }

  private async onMenu(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    if (msg === '1') return { reply: ASK_DATE, state: BotState.BOOK_DATE, ctx }
    if (msg === '2') return this.buildMyBookings(ctx, clubId, waId)
    if (msg === '3') return this.buildCancelList(ctx, clubId, waId)
    return { reply: BAD_OPTION, state: BotState.MENU, ctx }
  }

  private async onBookDate(msg: string, ctx: SessionContext, clubId: string): Promise<HandlerResult> {
    const date = parseDateDMY(msg)
    if (!date) return { reply: BAD_DATE, state: BotState.BOOK_DATE, ctx }

    const courts = await this.getAvailableCourts(clubId, date)
    if (courts.length === 0) return { reply: noCourts(date), state: BotState.MENU, ctx }

    const nextCtx: SessionContext = { ...ctx, selectedDate: date, courtOptions: courts }

    if (!ctx.playerName) return { reply: ASK_NAME, state: BotState.BOOK_NAME, ctx: nextCtx }

    return { reply: courtsList(courts, date), state: BotState.BOOK_COURT, ctx: nextCtx }
  }

  private async onBookName(msg: string, ctx: SessionContext, clubId: string): Promise<HandlerResult> {
    const name = msg.trim()
    if (name.length < 2) {
      return { reply: 'El nombre debe tener al menos 2 caracteres. ¿Cómo te llamás?', state: BotState.BOOK_NAME, ctx }
    }

    const nextCtx: SessionContext = { ...ctx, playerName: name }
    const courts = nextCtx.courtOptions ?? (await this.getAvailableCourts(clubId, nextCtx.selectedDate!))

    if (courts.length === 0) return { reply: noCourts(nextCtx.selectedDate!), state: BotState.MENU, ctx: nextCtx }

    return {
      reply: courtsList(courts, nextCtx.selectedDate!),
      state: BotState.BOOK_COURT,
      ctx: { ...nextCtx, courtOptions: courts },
    }
  }

  private async onBookCourt(msg: string, ctx: SessionContext, clubId: string): Promise<HandlerResult> {
    const courts = ctx.courtOptions ?? []
    const idx = parseInt(msg, 10) - 1

    if (isNaN(idx) || idx < 0 || idx >= courts.length) {
      return { reply: `${BAD_COURT}\n\n${courtsList(courts, ctx.selectedDate!)}`, state: BotState.BOOK_COURT, ctx }
    }

    const court = courts[idx]
    const slots = await this.getAvailableSlots(clubId, ctx.selectedDate!, court.id)

    if (slots.length === 0) {
      return { reply: NO_SLOTS, state: BotState.MENU, ctx: keepName(ctx) }
    }

    return {
      reply: slotsList(slots, court.name, ctx.selectedDate!),
      state: BotState.BOOK_SLOT,
      ctx: { ...ctx, selectedCourtId: court.id, selectedCourtName: court.name, slotOptions: slots },
    }
  }

  private onBookSlot(msg: string, ctx: SessionContext): HandlerResult {
    const slots = ctx.slotOptions ?? []
    const idx = parseInt(msg, 10) - 1

    if (isNaN(idx) || idx < 0 || idx >= slots.length) {
      return {
        reply: `${BAD_SLOT}\n\n${slotsList(slots, ctx.selectedCourtName!, ctx.selectedDate!)}`,
        state: BotState.BOOK_SLOT,
        ctx,
      }
    }

    const slot = slots[idx]
    const nextCtx: SessionContext = {
      ...ctx,
      selectedSlotId: slot.id,
      selectedSlotLabel: slot.label,
      selectedSlotPrice: slot.price,
    }

    return { reply: confirmBooking(nextCtx), state: BotState.BOOK_CONFIRM, ctx: nextCtx }
  }

  private async onBookConfirm(msg: string, ctx: SessionContext, clubId: string, waId: string): Promise<HandlerResult> {
    const answer = msg.toLowerCase()

    if (answer !== 's' && answer !== 'n') {
      return { reply: `${confirmBooking(ctx)}\n\nRespondé *S* o *N*.`, state: BotState.BOOK_CONFIRM, ctx }
    }
    if (answer === 'n') {
      return { reply: BOOKING_ABORTED, state: BotState.MENU, ctx: keepName(ctx) }
    }

    try {
      await this.bookingsService.book(clubId, {
        slotId: ctx.selectedSlotId!,
        playerName: ctx.playerName!,
        playerPhone: waId,
      })
      return { reply: bookingConfirmed(ctx), state: BotState.MENU, ctx: keepName(ctx) }
    } catch {
      return { reply: BOOKING_FAILED, state: BotState.MENU, ctx: keepName(ctx) }
    }
  }

  private onCancelSelect(msg: string, ctx: SessionContext): HandlerResult {
    if (msg === '0') return { reply: MENU, state: BotState.MENU, ctx: keepName(ctx) }

    const options = ctx.bookingOptions ?? []
    const idx = parseInt(msg, 10) - 1

    if (isNaN(idx) || idx < 0 || idx >= options.length) {
      return { reply: `${BAD_BOOKING}\n\n${cancelList(options)}`, state: BotState.CANCEL_SELECT, ctx }
    }

    const booking = options[idx]
    return {
      reply: confirmCancel(booking.label),
      state: BotState.CANCEL_CONFIRM,
      ctx: { ...ctx, selectedBookingId: booking.id, selectedBookingLabel: booking.label },
    }
  }

  private async onCancelConfirm(msg: string, ctx: SessionContext, clubId: string): Promise<HandlerResult> {
    const answer = msg.toLowerCase()

    if (answer !== 's' && answer !== 'n') {
      return { reply: `${confirmCancel(ctx.selectedBookingLabel!)}\n\nRespondé *S* o *N*.`, state: BotState.CANCEL_CONFIRM, ctx }
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

  private async getAvailableCourts(clubId: string, date: string): Promise<CourtOption[]> {
    const slots = await this.prisma.slot.findMany({
      where: {
        clubId,
        status: 'AVAILABLE',
        startsAt: { gte: new Date(`${date}T00:00:00`), lt: new Date(`${date}T23:59:59`) },
      },
      select: { courtId: true, court: { select: { name: true } } },
      distinct: ['courtId'],
      orderBy: { court: { name: 'asc' } },
    })
    return slots.map(s => ({ id: s.courtId, name: s.court.name }))
  }

  private async getAvailableSlots(clubId: string, date: string, courtId: string): Promise<SlotOption[]> {
    const slots = await this.prisma.slot.findMany({
      where: {
        clubId,
        courtId,
        status: 'AVAILABLE',
        startsAt: { gte: new Date(`${date}T00:00:00`), lt: new Date(`${date}T23:59:59`) },
      },
      select: { id: true, startsAt: true, endsAt: true, priceCents: true },
      orderBy: { startsAt: 'asc' },
    })
    return slots.map(s => ({ id: s.id, label: slotLabel(s.startsAt, s.endsAt), price: s.priceCents }))
  }

  private async findUserBookings(clubId: string, waId: string) {
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
 */
function parseDateDMY(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[\/\-](\d{1,2})$/)
  if (!m) return null

  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const now = new Date()
  let year = now.getFullYear()
  const candidate = new Date(year, month - 1, day)
  if (isNaN(candidate.getTime())) return null

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (candidate < today) year += 1

  const final = new Date(year, month - 1, day)
  if (isNaN(final.getTime())) return null

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function slotLabel(startsAt: Date, endsAt: Date): string {
  return `${pad2(startsAt.getHours())}:${pad2(startsAt.getMinutes())}–${pad2(endsAt.getHours())}:${pad2(endsAt.getMinutes())}`
}

function bookingLabel(b: { slot: { startsAt: Date; endsAt: Date; court: { name: string } } }): string {
  const { startsAt } = b.slot
  const dateStr = `${pad2(startsAt.getDate())}/${pad2(startsAt.getMonth() + 1)}`
  return `${dateStr} · ${b.slot.court.name} · ${slotLabel(b.slot.startsAt, b.slot.endsAt)}`
}

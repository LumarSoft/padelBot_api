import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateBookingDto } from './dto/create-booking.dto'
import { RescheduleBookingDto } from './dto/reschedule-booking.dto'
import { QueryBookingsDto } from './dto/query-bookings.dto'
import { Prisma, SlotStatus } from 'generated/prisma/client'
import { bandDateTimes, findBandInSchedule, generateBands } from '../availability/lib/schedule'
import { formatDayMonth, formatTimeRange } from '../availability/lib/datetime'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { BookingAction, BookingEventsService } from '../events/booking-events.service'

/** Booking a schedule band that may not have a materialized Slot row yet. */
export interface BookBandInput {
  courtId: string
  dateKey: string
  bandStart: string
  playerName: string
  playerPhone?: string
  notes?: string
}

const bookingSelect = {
  id: true,
  slotId: true,
  clubId: true,
  playerName: true,
  playerPhone: true,
  status: true,
  notes: true,
  recurringBookingId: true,
  bookedByUserId: true,
  depositCents: true,
  transferAmountCents: true,
  paymentExpiresAt: true,
  createdAt: true,
  updatedAt: true,
  slot: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      priceCents: true,
      status: true,
      court: { select: { id: true, name: true } },
    },
  },
} as const

/** Shape needed to build an event summary — satisfied by any `bookingSelect` row. */
type BookingForEvent = {
  clubId: string
  playerName: string
  slot: { startsAt: Date; endsAt: Date; court: { name: string } }
}

const PLAYERS_PER_MATCH = 4
/** Minutes a player has to transfer before the pending booking auto-cancels (env-tunable). */
const PAYMENT_WINDOW_MS = (Number(process.env.PAYMENT_WINDOW_MIN) || 30) * 60 * 1000

export interface PendingBookingResult {
  id: string
  depositCents: number
  /** Exact amount (cents) the player must transfer — unique among pending bookings. */
  transferAmountCents: number
}

type CancelledPendingInfo = { playerPhone: string | null; clubId: string }

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BookingEventsService,
  ) {}

  findAll(clubId: string, query: QueryBookingsDto) {
    return this.prisma.booking.findMany({
      where: {
        clubId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.playerPhone ? { playerPhone: query.playerPhone } : {}),
        ...(query.courtId || query.from || query.to
          ? {
              slot: {
                ...(query.courtId ? { courtId: query.courtId } : {}),
                ...(query.from || query.to
                  ? {
                      startsAt: {
                        ...(query.from ? { gte: new Date(query.from) } : {}),
                        ...(query.to ? { lte: new Date(query.to) } : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
      select: bookingSelect,
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(clubId: string, id: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, clubId },
      select: bookingSelect,
    })
    if (!booking) throw new NotFoundException(`Booking ${id} not found`)
    return booking
  }

  async book(clubId: string, dto: CreateBookingDto, bookedByUserId?: number) {
    const slot = await this.prisma.slot.findFirst({
      where: { id: dto.slotId, clubId },
      select: { id: true, status: true },
    })
    if (!slot) throw new NotFoundException(`Slot ${dto.slotId} not found`)
    if (slot.status !== SlotStatus.AVAILABLE) {
      throw new ConflictException(`Slot ${dto.slotId} is not available`)
    }

    const [, booking] = await this.prisma.$transaction([
      this.prisma.slot.update({
        where: { id: dto.slotId },
        data: { status: SlotStatus.BOOKED },
      }),
      this.prisma.booking.create({
        data: {
          slotId: dto.slotId,
          clubId,
          playerName: dto.playerName,
          playerPhone: dto.playerPhone ?? null,
          notes: dto.notes,
          bookedByUserId: bookedByUserId ?? null,
        },
        select: bookingSelect,
      }),
    ])

    this.emitBookingChange('created', booking)
    return booking
  }

  /**
   * Books a schedule band under the open-by-default model. If the Slot row
   * doesn't exist yet it is materialized as BOOKED at the court's default price;
   * if it exists it must be AVAILABLE. Wrapped in an interactive transaction so
   * the availability check and the write are atomic.
   */
  async bookBand(clubId: string, input: BookBandInput) {
    const court = await this.prisma.court.findFirst({
      where: { id: input.courtId, clubId },
      select: { priceCents: true, openTime: true, closeTime: true },
    })
    if (!court) throw new NotFoundException(`Court ${input.courtId} not found`)

    const bands = generateBands(court.openTime, court.closeTime)
    const band = findBandInSchedule(bands, input.bandStart)
    if (!band) throw new BadRequestException(`Invalid slot band ${input.bandStart}`)

    const { startsAt, endsAt } = bandDateTimes(input.dateKey, band)
    if (startsAt.getTime() <= Date.now()) {
      throw new ConflictException('Cannot book a slot in the past')
    }

    const booking = await this.prisma.$transaction(async tx => {
      const existing = await tx.slot.findFirst({
        where: { clubId, courtId: input.courtId, startsAt },
        select: { id: true, status: true },
      })

      let slotId: string
      if (existing) {
        if (existing.status !== SlotStatus.AVAILABLE) {
          throw new ConflictException('Slot is not available')
        }
        await tx.slot.update({ where: { id: existing.id }, data: { status: SlotStatus.BOOKED } })
        slotId = existing.id
      } else {
        try {
          const slot = await tx.slot.create({
            data: {
              clubId,
              courtId: input.courtId,
              startsAt,
              endsAt,
              priceCents: court.priceCents,
              status: SlotStatus.BOOKED,
            },
            select: { id: true },
          })
          slotId = slot.id
        } catch (error) {
          // Another writer (admin panel or a concurrent bot turn) materialized
          // this exact slot between our lookup and insert. The unique index on
          // (courtId, startsAt) rejects the duplicate — the band is taken now.
          if (isUniqueConstraintError(error)) {
            throw new ConflictException('Slot is not available')
          }
          throw error
        }
      }

      return tx.booking.create({
        data: {
          slotId,
          clubId,
          playerName: input.playerName,
          playerPhone: input.playerPhone ?? null,
          notes: input.notes,
        },
        select: bookingSelect,
      })
    })

    this.emitBookingChange('created', booking)
    return booking
  }

  async cancel(clubId: string, id: string) {
    const booking = await this.findOne(clubId, id)
    if (booking.status === 'CANCELLED') {
      throw new BadRequestException('Booking is already cancelled')
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.slot.update({
        where: { id: booking.slotId },
        data: { status: SlotStatus.AVAILABLE },
      }),
      this.prisma.booking.update({
        where: { id },
        data: { status: 'CANCELLED' },
        select: bookingSelect,
      }),
    ])

    this.emitBookingChange('cancelled', updated)
    return updated
  }

  async reschedule(clubId: string, id: string, dto: RescheduleBookingDto) {
    const booking = await this.findOne(clubId, id)
    if (booking.status === 'CANCELLED') {
      throw new BadRequestException('Cannot reschedule a cancelled booking')
    }
    if (booking.slotId === dto.newSlotId) {
      throw new BadRequestException('New slot must be different from the current slot')
    }

    const newSlot = await this.prisma.slot.findFirst({
      where: { id: dto.newSlotId, clubId },
      select: { id: true, status: true },
    })
    if (!newSlot) throw new NotFoundException(`Slot ${dto.newSlotId} not found`)
    if (newSlot.status !== SlotStatus.AVAILABLE) {
      throw new ConflictException(`Slot ${dto.newSlotId} is not available`)
    }

    const [, , updated] = await this.prisma.$transaction([
      this.prisma.slot.update({
        where: { id: booking.slotId },
        data: { status: SlotStatus.AVAILABLE },
      }),
      this.prisma.slot.update({
        where: { id: dto.newSlotId },
        data: { status: SlotStatus.BOOKED },
      }),
      this.prisma.booking.update({
        where: { id },
        data: { slotId: dto.newSlotId },
        select: bookingSelect,
      }),
    ])

    this.emitBookingChange('rescheduled', updated)
    return updated
  }

  // ── Pending-payment flow ────────────────────────────────────────────────────

  /**
   * Creates a booking in PENDING_PAYMENT status and locks the slot (BOOKED).
   * The slot stays locked until the payment is confirmed or the link expires.
   */
  async bookPending(clubId: string, dto: CreateBookingDto): Promise<PendingBookingResult> {
    const slot = await this.prisma.slot.findFirst({
      where: { id: dto.slotId, clubId },
      select: { id: true, status: true, priceCents: true },
    })
    if (!slot) throw new NotFoundException(`Slot ${dto.slotId} not found`)
    if (slot.status !== SlotStatus.AVAILABLE) throw new ConflictException(`Slot ${dto.slotId} is not available`)

    const depositCents = Math.ceil(slot.priceCents / PLAYERS_PER_MATCH)
    const paymentExpiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS)

    const booking = await this.prisma.$transaction(async tx => {
      const fresh = await tx.slot.findFirst({ where: { id: dto.slotId, clubId }, select: { status: true } })
      if (!fresh || fresh.status !== SlotStatus.AVAILABLE)
        throw new ConflictException(`Slot ${dto.slotId} is not available`)

      await tx.slot.update({ where: { id: dto.slotId }, data: { status: SlotStatus.BOOKED } })
      const transferAmountCents = await this.allocateTransferAmount(tx, depositCents)

      return tx.booking.create({
        data: {
          slotId: dto.slotId,
          clubId,
          playerName: dto.playerName,
          playerPhone: dto.playerPhone ?? null,
          notes: dto.notes,
          status: 'PENDING_PAYMENT',
          depositCents,
          transferAmountCents,
          paymentExpiresAt,
        },
        select: { id: true, depositCents: true, transferAmountCents: true },
      })
    })

    return { id: booking.id, depositCents: booking.depositCents, transferAmountCents: booking.transferAmountCents! }
  }

  /** Same as bookPending but materializes the slot when it doesn't exist yet. */
  async bookBandPending(clubId: string, input: BookBandInput): Promise<PendingBookingResult> {
    const court = await this.prisma.court.findFirst({
      where: { id: input.courtId, clubId },
      select: { priceCents: true, openTime: true, closeTime: true },
    })
    if (!court) throw new NotFoundException(`Court ${input.courtId} not found`)

    const bands = generateBands(court.openTime, court.closeTime)
    const band = findBandInSchedule(bands, input.bandStart)
    if (!band) throw new BadRequestException(`Invalid slot band ${input.bandStart}`)

    const { startsAt, endsAt } = bandDateTimes(input.dateKey, band)
    if (startsAt.getTime() <= Date.now()) throw new ConflictException('Cannot book a slot in the past')

    const depositCents = Math.ceil(court.priceCents / PLAYERS_PER_MATCH)
    const paymentExpiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS)

    const booking = await this.prisma.$transaction(async tx => {
      const existing = await tx.slot.findFirst({
        where: { clubId, courtId: input.courtId, startsAt },
        select: { id: true, status: true },
      })

      let slotId: string
      if (existing) {
        if (existing.status !== SlotStatus.AVAILABLE) throw new ConflictException('Slot is not available')
        await tx.slot.update({ where: { id: existing.id }, data: { status: SlotStatus.BOOKED } })
        slotId = existing.id
      } else {
        try {
          const slot = await tx.slot.create({
            data: {
              clubId,
              courtId: input.courtId,
              startsAt,
              endsAt,
              priceCents: court.priceCents,
              status: SlotStatus.BOOKED,
            },
            select: { id: true },
          })
          slotId = slot.id
        } catch (error) {
          if (isUniqueConstraintError(error)) throw new ConflictException('Slot is not available')
          throw error
        }
      }

      const transferAmountCents = await this.allocateTransferAmount(tx, depositCents)

      return tx.booking.create({
        data: {
          slotId,
          clubId,
          playerName: input.playerName,
          playerPhone: input.playerPhone ?? null,
          notes: input.notes,
          status: 'PENDING_PAYMENT',
          depositCents,
          transferAmountCents,
          paymentExpiresAt,
        },
        select: { id: true, depositCents: true, transferAmountCents: true },
      })
    })

    return { id: booking.id, depositCents: booking.depositCents, transferAmountCents: booking.transferAmountCents! }
  }

  /**
   * Picks the exact amount the player must transfer so an incoming transfer maps to
   * exactly one pending booking. Takes the deposit rounded down to whole pesos and
   * appends a unique 1-99 centavos tag not currently used by any other pending
   * booking sharing that whole-peso amount. Uniqueness is global (the MercadoPago
   * account is shared across clubs), and checked inside the caller's transaction.
   * Falls back to the raw deposit if all 99 tags are taken (manual confirmation
   * then resolves the ambiguity).
   */
  private async allocateTransferAmount(tx: Prisma.TransactionClient, depositCents: number): Promise<number> {
    const wholePesos = Math.floor(depositCents / 100) * 100
    const taken = await tx.booking.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        transferAmountCents: { gte: wholePesos + 1, lte: wholePesos + 99 },
      },
      select: { transferAmountCents: true },
    })
    const usedTags = new Set(taken.map(b => b.transferAmountCents! - wholePesos))
    for (let tag = 1; tag <= 99; tag++) {
      if (!usedTags.has(tag)) return wholePesos + tag
    }
    this.logger.warn(`No free transfer-amount tag for ${wholePesos} — falling back to raw deposit`)
    return depositCents
  }

  /**
   * Idempotent: if the booking is not in PENDING_PAYMENT (already processed),
   * it returns false without making any changes. `paymentRef` records the source
   * of truth for the confirmation (an MP payment id, a bridge id, or null for a
   * manual admin confirmation).
   */
  async confirmPayment(bookingId: string, paymentRef?: string | null): Promise<boolean> {
    const { count } = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: 'PENDING_PAYMENT' },
      data: { status: 'CONFIRMED', mpPaymentId: paymentRef ?? null },
    })
    if (count === 0) return false

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        clubId: true,
        playerName: true,
        slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
      },
    })
    if (booking) this.emitBookingChange('created', booking)

    return true
  }

  /**
   * Confirms a pending booking by matching the exact transferred amount against
   * `transferAmountCents`, where the payment fell inside the booking's pending
   * window (`createdAt <= paidAt <= paymentExpiresAt`). The window guard matters
   * for polling: it stops a stale payment from confirming a newer booking that
   * happened to be assigned the same (freed-up) amount. Confirms ONLY on a single
   * match — otherwise it leaves everything for manual review (never auto-confirm
   * an ambiguous transfer). Returns the confirmed booking id, or null.
   */
  async confirmPaymentByAmount(amountCents: number, paymentRef: string, paidAt: Date): Promise<string | null> {
    const candidates = await this.prisma.booking.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        transferAmountCents: amountCents,
        createdAt: { lte: paidAt },
        paymentExpiresAt: { gte: paidAt },
      },
      select: { id: true },
    })

    if (candidates.length !== 1) {
      this.logger.warn(
        `Transfer of ${amountCents} cents matched ${candidates.length} pending bookings (ref ${paymentRef}) — needs manual review`,
      )
      return null
    }

    const confirmed = await this.confirmPayment(candidates[0].id, paymentRef)
    return confirmed ? candidates[0].id : null
  }

  /**
   * The player's most recent still-valid pending-payment booking (matched by phone).
   * Used by the bot to reassure a player who says they already transferred / sent a
   * receipt, without confirming anything (only the real money confirms).
   */
  findActivePendingForPlayer(clubId: string, playerPhone: string) {
    return this.prisma.booking.findFirst({
      where: { clubId, playerPhone, status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        transferAmountCents: true,
        slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
      },
    })
  }

  /**
   * Manual confirmation from the admin panel (front-desk verified the money landed).
   * Club-scoped and idempotent. Returns the booking id when it flips a pending
   * booking to CONFIRMED, or null if it was already processed.
   */
  async confirmPaymentManual(clubId: string, bookingId: string): Promise<string | null> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clubId },
      select: { id: true, status: true },
    })
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`)
    if (booking.status !== 'PENDING_PAYMENT') return null

    const confirmed = await this.confirmPayment(bookingId, null)
    return confirmed ? bookingId : null
  }

  /**
   * Manual rejection from the admin panel (money never arrived). Club-scoped;
   * cancels the pending booking and releases the slot. Returns the cancelled
   * booking info for the WhatsApp notification, or null if it was not pending.
   */
  async rejectPayment(clubId: string, bookingId: string): Promise<CancelledPendingInfo | null> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clubId },
      select: { id: true, status: true },
    })
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`)
    if (booking.status !== 'PENDING_PAYMENT') return null

    return this.cancelPending(bookingId)
  }

  /**
   * Cancels a PENDING_PAYMENT booking and releases the slot.
   * Returns null if the booking was already confirmed or cancelled (idempotent).
   */
  async cancelPending(bookingId: string): Promise<CancelledPendingInfo | null> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        slotId: true,
        status: true,
        playerPhone: true,
        clubId: true,
        playerName: true,
        slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
      },
    })
    if (!booking || booking.status !== 'PENDING_PAYMENT') return null

    await this.prisma.$transaction([
      this.prisma.slot.update({ where: { id: booking.slotId }, data: { status: SlotStatus.AVAILABLE } }),
      this.prisma.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } }),
    ])

    this.emitBookingChange('cancelled', booking)
    return { playerPhone: booking.playerPhone, clubId: booking.clubId }
  }

  /**
   * Finds all PENDING_PAYMENT bookings whose payment link has expired,
   * cancels them, and releases their slots.
   */
  async findAndCancelExpiredPending(): Promise<CancelledPendingInfo[]> {
    const expired = await this.prisma.booking.findMany({
      where: { status: 'PENDING_PAYMENT', paymentExpiresAt: { lt: new Date() } },
      select: {
        id: true,
        slotId: true,
        playerPhone: true,
        clubId: true,
        playerName: true,
        slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
      },
    })

    const results: CancelledPendingInfo[] = []

    for (const booking of expired) {
      try {
        await this.prisma.$transaction([
          this.prisma.slot.update({ where: { id: booking.slotId }, data: { status: SlotStatus.AVAILABLE } }),
          this.prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } }),
        ])
        this.emitBookingChange('cancelled', booking)
        results.push({ playerPhone: booking.playerPhone, clubId: booking.clubId })
      } catch (err) {
        this.logger.error(`Failed to cancel expired booking ${booking.id}`, err)
      }
    }

    return results
  }

  /**
   * Broadcasts a booking change to the club's connected admins (live dashboard).
   * Best-effort: emitting never blocks or fails the booking itself.
   */
  private emitBookingChange(action: BookingAction, booking: BookingForEvent): void {
    const { startsAt, endsAt, court } = booking.slot
    this.events.emit({
      type: 'booking.changed',
      clubId: booking.clubId,
      action,
      summary: `${booking.playerName} · ${court.name} · ${formatDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}`,
    })
  }
}

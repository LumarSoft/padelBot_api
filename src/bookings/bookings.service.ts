import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateBookingDto } from './dto/create-booking.dto'
import { RescheduleBookingDto } from './dto/reschedule-booking.dto'
import { QueryBookingsDto } from './dto/query-bookings.dto'
import { SetBookingProductsDto } from './dto/set-booking-products.dto'
import { LocalPaymentDto } from './dto/local-payment.dto'
import { AddPlayerPaymentDto } from './dto/add-player-payment.dto'
import { BookingAccountView, computeAccount } from './lib/account'
import { DepositOutcome, PlayerRescheduleMode, Prisma, SlotStatus } from 'generated/prisma/client'
import { bandDateTimes, bandsForDate, courtScheduleSelect, findBandInSchedule } from '../availability/lib/schedule'
import { resolveBandPriceCents } from '../availability/lib/pricing'
import { dniFromIdentification, dniMatches } from '../common/identity'
import { formatDayMonth, formatTimeRange } from '../availability/lib/datetime'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { BookingAction, BookingEventsService } from '../events/booking-events.service'
import { ReceiptStorageService } from '../storage/receipt-storage.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PlayersService } from '../players/players.service'
import { SlotPricingService } from '../pricing/slot-pricing.service'

/** Booking a schedule band that may not have a materialized Slot row yet. */
export interface BookBandInput {
  courtId: string
  dateKey: string
  bandStart: string
  playerName: string
  playerPhone?: string
  playerDni?: string
  notes?: string
}

const bookingSelect = {
  id: true,
  slotId: true,
  clubId: true,
  playerName: true,
  playerPhone: true,
  playerDni: true,
  payerCuit: true,
  payerEmail: true,
  status: true,
  notes: true,
  playerId: true,
  noShowAt: true,
  creditAppliedCents: true,
  depositOutcome: true,
  localPaymentCents: true,
  localPaymentMethod: true,
  settledAt: true,
  recurringBookingId: true,
  bookedByUserId: true,
  depositCents: true,
  transferAmountCents: true,
  mpPaymentId: true,
  paymentExpiresAt: true,
  receiptUploadedAt: true,
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
  // Count of receipt images so the panel knows to render the thumbnail / "review now" badge.
  _count: { select: { receipts: true } },
  bookingProducts: {
    select: {
      id: true,
      quantity: true,
      unitPriceCents: true,
      playerMask: true,
      product: { select: { id: true, name: true, category: true } },
    },
  },
} as const

/** Shape needed to build an event summary — satisfied by any `bookingSelect` row. */
type BookingForEvent = {
  id: string
  clubId: string
  playerName: string
  slot: { startsAt: Date; endsAt: Date; court: { name: string } }
}

/** Replaces the internal `_count.receipts` with a clean `hasReceipt` boolean for the client. */
function withReceiptFlag<T extends { _count: { receipts: number } }>(
  booking: T,
): Omit<T, '_count'> & { hasReceipt: boolean } {
  const { _count, ...rest } = booking
  return { ...rest, hasReceipt: _count.receipts > 0 }
}

/** Converts a `playerMask` bit (bit0=J1 … bit3=J4) into the array of player positions it covers. */
function playersFromMask(mask: number): number[] {
  const players: number[] = []
  for (let position = 1; position <= 4; position++) {
    if (mask & (1 << (position - 1))) players.push(position)
  }
  return players
}

/** Replaces each consumo line's internal `playerMask` with the client-facing `players` array. */
function withPlayers<T extends { bookingProducts: { playerMask: number }[] }>(booking: T) {
  return {
    ...booking,
    bookingProducts: booking.bookingProducts.map(({ playerMask, ...rest }) => ({
      ...rest,
      players: playersFromMask(playerMask),
    })),
  }
}

/** Default seña percentage (one of four padel players) when a club has none set. */
const DEFAULT_DEPOSIT_PERCENT = 25
/** Rounds a cents amount to whole pesos — the clean amount a known payer transfers. */
const roundToWholePesos = (cents: number): number => Math.round(cents / 100) * 100
/** Minutes a player has to transfer before the pending booking auto-cancels (env-tunable). */
const PAYMENT_WINDOW_MS = (Number(process.env.PAYMENT_WINDOW_MIN) || 30) * 60 * 1000
/** No-shows before the bot demands the FULL court price as the deposit. */
const NO_SHOW_FULL_THRESHOLD = Number(process.env.NO_SHOW_FULL_THRESHOLD) || 3

export interface PendingBookingResult {
  id: string
  depositCents: number
  /** Exact amount (cents) the player must transfer — unique among pending bookings.
   *  0 when the whole deposit was covered by player credit. */
  transferAmountCents: number
  /** Player credit (cents) consumed to reduce the required transfer. */
  creditAppliedCents: number
  /** True when credit covered the whole deposit — the booking is already CONFIRMED. */
  confirmedByCredit: boolean
}

type CancelledPendingInfo = { playerPhone: string | null; clubId: string }

/** Identity of who actually transferred, captured from MercadoPago. */
export interface PayerInfo {
  cuit?: string | null
  email?: string | null
  mpUserId?: string | null
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BookingEventsService,
    private readonly receiptStorage: ReceiptStorageService,
    private readonly notifications: NotificationsService,
    private readonly players: PlayersService,
    private readonly slotPricing: SlotPricingService,
  ) {}

  async findAll(clubId: string, query: QueryBookingsDto) {
    const bookings = await this.prisma.booking.findMany({
      where: {
        clubId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.playerPhone ? { playerPhone: query.playerPhone } : {}),
        ...(query.search
          ? {
              OR: [
                { playerName: { contains: query.search } },
                { playerPhone: { contains: query.search.replace(/\D/g, '') || query.search } },
              ],
            }
          : {}),
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
      // A search reads best in slot order (next matches first) and stays bounded.
      orderBy: query.search ? { slot: { startsAt: 'desc' } } : { createdAt: 'desc' },
      ...(query.search ? { take: 30 } : {}),
    })
    return bookings.map(booking => withPlayers(withReceiptFlag(booking)))
  }

  async findOne(clubId: string, id: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, clubId, deletedAt: null },
      select: bookingSelect,
    })
    if (!booking) throw new NotFoundException(`Booking ${id} not found`)
    return withPlayers(withReceiptFlag(booking))
  }

  /**
   * Soft-deletes a booking so it drops out of the club's lists (mobile/panel). Only a
   * CANCELLED reservation can be removed — an active or pending one must go through its
   * lifecycle first. The row is kept in the DB (audit/stats) with `deletedAt` set; read
   * paths filter it out. `findOne` already scopes by club and rejects an already-deleted id.
   */
  async remove(clubId: string, id: string): Promise<void> {
    const booking = await this.findOne(clubId, id)
    if (booking.status !== 'CANCELLED') {
      throw new BadRequestException('Solo se pueden eliminar reservas canceladas')
    }
    await this.prisma.booking.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  }

  async book(clubId: string, dto: CreateBookingDto, bookedByUserId?: number) {
    const slot = await this.prisma.slot.findFirst({
      where: { id: dto.slotId, clubId },
      select: { id: true, status: true, priceCents: true },
    })
    if (!slot) throw new NotFoundException(`Slot ${dto.slotId} not found`)
    if (slot.status !== SlotStatus.AVAILABLE) {
      throw new ConflictException(`Slot ${dto.slotId} is not available`)
    }

    const { depositCents } = await this.resolvePaymentPlan(clubId, slot.priceCents)
    const playerId = await this.players.upsertForBooking(clubId, dto.playerPhone, { name: dto.playerName })

    const booking = await this.prisma.$transaction(async tx => {
      // Atomic check-and-lock: only the writer that flips AVAILABLE→BOOKED proceeds.
      await this.lockSlotOrThrow(tx, dto.slotId, clubId)
      return tx.booking.create({
        data: {
          slotId: dto.slotId,
          clubId,
          playerName: dto.playerName,
          playerPhone: dto.playerPhone ?? null,
          playerId,
          notes: dto.notes,
          bookedByUserId: bookedByUserId ?? null,
          depositCents,
        },
        select: bookingSelect,
      })
    })

    this.emitBookingChange('created', booking)
    return booking
  }

  /**
   * Atomically flips a slot AVAILABLE→BOOKED. The conditional `updateMany` is a single
   * SQL `UPDATE ... WHERE status='AVAILABLE'`, so exactly one of two concurrent bookers
   * can win — the loser gets a clean ConflictException instead of a silent double-booking.
   */
  private async lockSlotOrThrow(tx: Prisma.TransactionClient, slotId: string, clubId: string): Promise<void> {
    const { count } = await tx.slot.updateMany({
      where: { id: slotId, clubId, status: SlotStatus.AVAILABLE },
      data: { status: SlotStatus.BOOKED },
    })
    if (count !== 1) throw new ConflictException(`Slot ${slotId} is not available`)
  }

  /**
   * Materializes a brand-new BOOKED slot for an open band. The unique index on
   * (courtId, startsAt) makes the insert the atomic guard: if a concurrent writer
   * created the same band first, P2002 is mapped to a clean ConflictException.
   */
  private async createBookedSlot(
    tx: Prisma.TransactionClient,
    data: { clubId: string; courtId: string; startsAt: Date; endsAt: Date; priceCents: number },
  ): Promise<string> {
    try {
      const slot = await tx.slot.create({ data: { ...data, status: SlotStatus.BOOKED }, select: { id: true } })
      return slot.id
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('El turno ya no está disponible')
      throw error
    }
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
      select: {
        priceCents: true,
        ...courtScheduleSelect,
        priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
      },
    })
    if (!court) throw new NotFoundException(`Court ${input.courtId} not found`)

    const bands = bandsForDate(court, input.dateKey)
    const band = findBandInSchedule(bands, input.bandStart)
    if (!band) throw new BadRequestException(`Invalid slot band ${input.bandStart}`)

    const { startsAt, endsAt } = bandDateTimes(input.dateKey, band)
    if (startsAt.getTime() <= Date.now()) {
      throw new ConflictException('Cannot book a slot in the past')
    }

    const bandPriceCents = resolveBandPriceCents(court.priceCents, court.priceRules, input.dateKey, band.start)
    const playerId = await this.players.upsertForBooking(clubId, input.playerPhone, { name: input.playerName })

    const booking = await this.prisma.$transaction(async tx => {
      const existing = await tx.slot.findFirst({
        where: { clubId, courtId: input.courtId, startsAt },
        select: { id: true, status: true },
      })

      let slotId: string
      if (existing) {
        await this.lockSlotOrThrow(tx, existing.id, clubId)
        slotId = existing.id
      } else {
        slotId = await this.createBookedSlot(tx, {
          clubId,
          courtId: input.courtId,
          startsAt,
          endsAt,
          priceCents: bandPriceCents,
        })
      }

      return tx.booking.create({
        data: {
          slotId,
          clubId,
          playerName: input.playerName,
          playerPhone: input.playerPhone ?? null,
          playerId,
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
      throw new BadRequestException('La reserva ya fue cancelada')
    }

    // Where does the deposit go? Only bookings from the paid flow carry a
    // transferAmountCents; a CONFIRMED one means real money was received.
    // Early cancellation (≥ club.cancellationWindowHours before the slot) turns the
    // deposit + any applied credit into player credit; a late one forfeits it. The
    // money stops disappearing from the numbers either way.
    const { depositOutcome, creditDeltaCents } = await this.resolveCancellationOutcome(clubId, booking)

    const updated = await this.prisma.$transaction(async tx => {
      // Conditional on the status the policy above was computed from: the payment poller can
      // confirm a PENDING booking between our read and this write, and cancelling it as if it
      // were still unpaid would silently swallow the deposit that just landed.
      const { count } = await tx.booking.updateMany({
        where: { id, status: booking.status },
        data: { status: 'CANCELLED', depositOutcome },
      })
      if (count !== 1) return null

      await tx.slot.update({ where: { id: booking.slotId }, data: { status: SlotStatus.AVAILABLE } })
      if (creditDeltaCents > 0 && booking.playerId) {
        await tx.player.update({
          where: { id: booking.playerId },
          data: { creditCents: { increment: creditDeltaCents } },
        })
      }
      return tx.booking.findUnique({ where: { id }, select: bookingSelect })
    })

    if (!updated) {
      throw new ConflictException('La reserva cambió de estado mientras la cancelábamos. Volvé a abrirla y fijate.')
    }

    // Back on sale: the band must quote today's price, not the one this reservation was sold
    // at (the club may have raised prices since). The waitlist offer below goes out with it.
    const priceCents = (await this.slotPricing.repriceSlot(booking.slotId, clubId)) ?? updated.slot.priceCents

    this.emitBookingChange('cancelled', updated)
    this.events.emitSlotFreed({
      type: 'slot.freed',
      clubId,
      courtId: updated.slot.court.id,
      courtName: updated.slot.court.name,
      startsAt: updated.slot.startsAt,
      endsAt: updated.slot.endsAt,
      priceCents,
    })
    return updated
  }

  /**
   * Applies the club's cancellation policy to a booking being cancelled.
   * - CONFIRMED + paid deposit + cancelled early → CREDITED (deposit + applied credit
   *   become player credit; the club avoids a manual refund and keeps the player).
   * - CONFIRMED + paid deposit + cancelled late → FORFEITED (recorded, not lost silently).
   * - PENDING (nothing paid yet) → no outcome; only the applied credit is restored.
   */
  private async resolveCancellationOutcome(
    clubId: string,
    booking: {
      status: string
      playerId: string | null
      transferAmountCents: number | null
      creditAppliedCents?: number
      slot: { startsAt: Date | string }
    },
  ): Promise<{ depositOutcome: DepositOutcome | null; creditDeltaCents: number }> {
    const creditApplied = booking.creditAppliedCents ?? 0

    if (booking.status !== 'CONFIRMED' || booking.transferAmountCents === null) {
      // Unpaid (pending/admin) booking: just give back any credit it consumed.
      return { depositOutcome: null, creditDeltaCents: creditApplied }
    }

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { cancellationWindowHours: true },
    })
    const windowMs = (club?.cancellationWindowHours ?? 24) * 60 * 60 * 1000
    const startsAt = new Date(booking.slot.startsAt)
    const early = startsAt.getTime() - Date.now() >= windowMs

    if (early) {
      return { depositOutcome: DepositOutcome.CREDITED, creditDeltaCents: booking.transferAmountCents + creditApplied }
    }
    return { depositOutcome: DepositOutcome.FORFEITED, creditDeltaCents: 0 }
  }

  async reschedule(clubId: string, id: string, dto: RescheduleBookingDto) {
    const booking = await this.findOne(clubId, id)
    if (booking.status === 'CANCELLED') {
      throw new BadRequestException('No se puede reprogramar una reserva cancelada')
    }
    if (booking.slotId === dto.newSlotId) {
      throw new BadRequestException('El nuevo turno debe ser distinto al actual')
    }

    const newSlot = await this.prisma.slot.findFirst({
      where: { id: dto.newSlotId, clubId },
      select: { id: true, status: true },
    })
    if (!newSlot) throw new NotFoundException(`Turno destino no encontrado`)
    if (newSlot.status !== SlotStatus.AVAILABLE) {
      throw new ConflictException(`El turno destino no está disponible`)
    }

    const updated = await this.prisma.$transaction(async tx => {
      await tx.slot.update({ where: { id: booking.slotId }, data: { status: SlotStatus.AVAILABLE } })
      // Atomic lock on the target slot: if another reschedule/booking took it first, the
      // whole transaction (including the release above) rolls back cleanly.
      await this.lockSlotOrThrow(tx, dto.newSlotId, clubId)
      // Reset so BookingRemindersService re-evaluates against the new slot time — otherwise a
      // reminder already sent for the old time would suppress the (now-wrong) one for the new time.
      return tx.booking.update({
        where: { id },
        data: { slotId: dto.newSlotId, reminderSentAt: null },
        select: bookingSelect,
      })
    })

    // The hour the player gave back goes on sale again — at today's price.
    await this.slotPricing.repriceSlot(booking.slotId, clubId)

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

    const plan = await this.resolvePaymentPlan(clubId, slot.priceCents)
    const policy = await this.applyPlayerPolicy(clubId, dto, slot.priceCents, plan.depositCents)
    const known = await this.findKnownPayerIdentity(clubId, dto.playerPhone)

    return this.createPendingWithCredit(clubId, policy, plan.roundAmount, known, async (tx, data) => {
      // Atomic check-and-lock — the loser of a concurrent race gets a clean conflict.
      await this.lockSlotOrThrow(tx, dto.slotId, clubId)
      return tx.booking.create({
        data: {
          slotId: dto.slotId,
          clubId,
          playerName: dto.playerName,
          playerPhone: dto.playerPhone ?? null,
          playerDni: dto.playerDni ?? null,
          // Stamp the expected payer so a colliding round amount reconciles to the right booking.
          payerMpUserId: known.mpUserId,
          notes: dto.notes,
          ...data,
        },
        select: { id: true, depositCents: true, transferAmountCents: true, creditAppliedCents: true, status: true },
      })
    })
  }

  /** Same as bookPending but materializes the slot when it doesn't exist yet. */
  async bookBandPending(clubId: string, input: BookBandInput): Promise<PendingBookingResult> {
    const court = await this.prisma.court.findFirst({
      where: { id: input.courtId, clubId },
      select: {
        priceCents: true,
        ...courtScheduleSelect,
        priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
      },
    })
    if (!court) throw new NotFoundException(`Cancha no encontrada`)

    const bands = bandsForDate(court, input.dateKey)
    const band = findBandInSchedule(bands, input.bandStart)
    if (!band) throw new BadRequestException(`Horario no válido para esta cancha`)

    const { startsAt, endsAt } = bandDateTimes(input.dateKey, band)
    if (startsAt.getTime() <= Date.now()) throw new ConflictException('No se puede reservar un turno que ya pasó')

    const bandPriceCents = resolveBandPriceCents(court.priceCents, court.priceRules, input.dateKey, band.start)
    const plan = await this.resolvePaymentPlan(clubId, bandPriceCents)
    const policy = await this.applyPlayerPolicy(clubId, input, bandPriceCents, plan.depositCents)
    const known = await this.findKnownPayerIdentity(clubId, input.playerPhone)

    return this.createPendingWithCredit(clubId, policy, plan.roundAmount, known, async (tx, data) => {
      const existing = await tx.slot.findFirst({
        where: { clubId, courtId: input.courtId, startsAt },
        select: { id: true, status: true },
      })

      let slotId: string
      if (existing) {
        await this.lockSlotOrThrow(tx, existing.id, clubId)
        slotId = existing.id
      } else {
        slotId = await this.createBookedSlot(tx, {
          clubId,
          courtId: input.courtId,
          startsAt,
          endsAt,
          priceCents: bandPriceCents,
        })
      }

      return tx.booking.create({
        data: {
          slotId,
          clubId,
          playerName: input.playerName,
          playerPhone: input.playerPhone ?? null,
          playerDni: input.playerDni ?? null,
          // Stamp the expected payer so a colliding round amount reconciles to the right booking.
          payerMpUserId: known.mpUserId,
          notes: input.notes,
          ...data,
        },
        select: { id: true, depositCents: true, transferAmountCents: true, creditAppliedCents: true, status: true },
      })
    })
  }

  /**
   * Shared core of the pending-booking flow with player credit: consumes available
   * credit to reduce (or fully cover) the deposit inside the same transaction that
   * locks the slot. When credit covers everything the booking is created CONFIRMED
   * directly — no transfer, no expiry window.
   */
  private async createPendingWithCredit(
    clubId: string,
    policy: { depositCents: number; playerId: string | null; availableCreditCents: number },
    roundAmount: boolean,
    known: { mpUserId: string | null },
    create: (
      tx: Prisma.TransactionClient,
      data: {
        playerId: string | null
        status: 'PENDING_PAYMENT' | 'CONFIRMED'
        depositCents: number
        creditAppliedCents: number
        transferAmountCents: number | null
        paymentExpiresAt: Date | null
      },
    ) => Promise<{
      id: string
      depositCents: number
      transferAmountCents: number | null
      creditAppliedCents: number
      status: string
    }>,
  ): Promise<PendingBookingResult> {
    const { depositCents, playerId, availableCreditCents } = policy
    const creditApplied = playerId ? Math.min(availableCreditCents, depositCents) : 0
    const remainingCents = depositCents - creditApplied
    const coveredByCredit = creditApplied > 0 && remainingCents === 0

    const booking = await this.prisma.$transaction(async tx => {
      if (creditApplied > 0) await this.consumeCredit(tx, playerId!, creditApplied)
      const transferAmountCents = coveredByCredit
        ? null
        : remainingCents === depositCents
          ? await this.resolvePendingTransferAmount(tx, depositCents, roundAmount, known)
          : // Credit already made the amount unusual — a round remainder keeps it simple
            // and identity/manual review disambiguates if it ever collides.
            remainingCents
      return create(tx, {
        playerId,
        status: coveredByCredit ? 'CONFIRMED' : 'PENDING_PAYMENT',
        depositCents,
        creditAppliedCents: creditApplied,
        transferAmountCents,
        paymentExpiresAt: coveredByCredit ? null : new Date(Date.now() + PAYMENT_WINDOW_MS),
      })
    })

    return {
      id: booking.id,
      depositCents: booking.depositCents,
      transferAmountCents: booking.transferAmountCents ?? 0,
      creditAppliedCents: booking.creditAppliedCents,
      confirmedByCredit: booking.status === 'CONFIRMED',
    }
  }

  /**
   * Resolves the club's payment policy for a booking: how much the player must transfer
   * (the full court price when depositMode = FULL, else a percentage of it as the seña —
   * default 25%, one of four padel players; a 0-priced court yields 0), whether the club
   * requires DNI-matched confirmation, and whether the transfer amount should be a clean
   * round number. The amount is rounded (no centavos tag) when the deposit isn't reconciled
   * by a unique amount — i.e. in DNI mode (payer identity disambiguates) or in RECEIPT mode
   * (an admin verifies the receipt photo by hand, so the centavos trick is unnecessary).
   */
  private async resolvePaymentPlan(
    clubId: string,
    priceCents: number,
  ): Promise<{ depositCents: number; requireDniMatch: boolean; roundAmount: boolean }> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { depositMode: true, depositPercent: true, requireDniMatch: true, paymentVerificationMode: true },
    })
    const depositCents =
      club?.depositMode === 'FULL'
        ? priceCents
        : Math.ceil((priceCents * (club?.depositPercent ?? DEFAULT_DEPOSIT_PERCENT)) / 100)
    const requireDniMatch = club?.requireDniMatch ?? false
    const roundAmount = requireDniMatch || club?.paymentVerificationMode === 'RECEIPT'
    return { depositCents, requireDniMatch, roundAmount }
  }

  /**
   * CRM hook on the player-facing (bot) booking paths: links/refreshes the Player,
   * refuses blocked players, and at NO_SHOW_FULL_THRESHOLD ausencias escalates the
   * deposit to the FULL court price (the club stops absorbing the no-show risk).
   * Admin-created bookings skip this — the front desk can always override.
   */
  private async applyPlayerPolicy(
    clubId: string,
    input: { playerPhone?: string | null; playerName?: string | null; playerDni?: string | null },
    priceCents: number,
    depositCents: number,
  ): Promise<{ depositCents: number; playerId: string | null; availableCreditCents: number }> {
    const playerId = await this.players.upsertForBooking(clubId, input.playerPhone, {
      name: input.playerName,
      dni: input.playerDni,
    })
    if (!playerId) return { depositCents, playerId: null, availableCreditCents: 0 }

    const standing = await this.players.standingForPhone(clubId, input.playerPhone)
    if (standing?.isBlocked) {
      throw new ForbiddenException('Este número no puede reservar por acá. Comunicate directamente con el club.')
    }
    const availableCreditCents = standing?.creditCents ?? 0
    if ((standing?.noShowCount ?? 0) >= NO_SHOW_FULL_THRESHOLD) {
      return { depositCents: priceCents, playerId, availableCreditCents }
    }
    return { depositCents, playerId, availableCreditCents }
  }

  /**
   * Atomically consumes player credit inside the booking transaction. Conditional
   * update so two concurrent bookings can't spend the same credit twice.
   */
  private async consumeCredit(tx: Prisma.TransactionClient, playerId: string, amountCents: number): Promise<void> {
    const { count } = await tx.player.updateMany({
      where: { id: playerId, creditCents: { gte: amountCents } },
      data: { creditCents: { decrement: amountCents } },
    })
    if (count !== 1) throw new ConflictException('El crédito a favor ya no está disponible, probá de nuevo')
  }

  /**
   * Marks a booking as a no-show (the player never came) and bumps the player's
   * counter — at NO_SHOW_FULL_THRESHOLD the bot starts demanding the full price
   * upfront. Idempotent per booking; unmark undoes both sides.
   */
  async markNoShow(clubId: string, id: string): Promise<{ noShowAt: Date }> {
    const booking = await this.prisma.booking.findFirst({
      where: { id, clubId },
      select: { id: true, status: true, noShowAt: true, playerId: true },
    })
    if (!booking) throw new NotFoundException('Reserva no encontrada')
    if (booking.status !== 'CONFIRMED')
      throw new BadRequestException('Solo una reserva confirmada puede marcarse ausente')
    if (booking.noShowAt) return { noShowAt: booking.noShowAt }

    const noShowAt = new Date()
    await this.prisma.$transaction([
      this.prisma.booking.update({ where: { id }, data: { noShowAt } }),
      ...(booking.playerId
        ? [this.prisma.player.update({ where: { id: booking.playerId }, data: { noShowCount: { increment: 1 } } })]
        : []),
    ])
    return { noShowAt }
  }

  // ── Cuenta del turno (cierre) ───────────────────────────────────────────────

  /**
   * The turno's bill: what each of the 4 players owes (cancha ÷ 4 + sus consumos),
   * what each already put in (la seña se acredita a J1, quien reservó), and whether
   * the account is settled. This is the panel's "finalizar turno" view.
   */
  async getAccount(clubId: string, bookingId: string): Promise<BookingAccountView> {
    const { view } = await this.loadAccount(clubId, bookingId)
    return view
  }

  /**
   * Registers one player's payment (efectivo / QR del local / transferencia declarada)
   * and settles the booking automatically when the whole bill is covered. Returns the
   * refreshed account so the panel updates in one round trip.
   */
  async addPlayerPayment(clubId: string, bookingId: string, dto: AddPlayerPaymentDto): Promise<BookingAccountView> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clubId },
      select: { id: true, status: true },
    })
    if (!booking) throw new NotFoundException('Reserva no encontrada')
    if (booking.status === 'CANCELLED') throw new BadRequestException('La reserva está cancelada')

    await this.prisma.bookingPlayerPayment.create({
      data: { clubId, bookingId, playerSlot: dto.playerSlot, amountCents: dto.amountCents, method: dto.method },
    })
    return this.refreshSettled(clubId, bookingId)
  }

  /** Undoes a registered payment (mistakes happen at the mostrador). */
  async removePlayerPayment(clubId: string, bookingId: string, paymentId: string): Promise<BookingAccountView> {
    const { count } = await this.prisma.bookingPlayerPayment.deleteMany({
      where: { id: paymentId, bookingId, clubId },
    })
    if (count === 0) throw new NotFoundException('Pago no encontrado')
    return this.refreshSettled(clubId, bookingId)
  }

  /** Recomputes the bill and keeps `settledAt` in sync with it. */
  private async refreshSettled(clubId: string, bookingId: string): Promise<BookingAccountView> {
    const { view, settledAt } = await this.loadAccount(clubId, bookingId)
    const shouldBeSettled = view.remainingCents === 0 && view.paidCents > 0
    if (shouldBeSettled && !settledAt) {
      const now = new Date()
      await this.prisma.booking.update({ where: { id: bookingId }, data: { settledAt: now } })
      return { ...view, settledAt: now }
    }
    if (!shouldBeSettled && settledAt) {
      await this.prisma.booking.update({ where: { id: bookingId }, data: { settledAt: null } })
      return { ...view, settledAt: null }
    }
    return view
  }

  private async loadAccount(
    clubId: string,
    bookingId: string,
  ): Promise<{ view: BookingAccountView; settledAt: Date | null }> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clubId },
      select: {
        status: true,
        settledAt: true,
        transferAmountCents: true,
        creditAppliedCents: true,
        localPaymentCents: true,
        slot: { select: { priceCents: true } },
        bookingProducts: { select: { quantity: true, unitPriceCents: true, playerMask: true } },
        playerPayments: {
          select: { id: true, playerSlot: true, amountCents: true, method: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!booking) throw new NotFoundException('Reserva no encontrada')

    // Deposit actually paid: only a CONFIRMED bot-flow booking received money up front
    // (the transfer asked + any player credit consumed at creation).
    const depositPaidCents =
      booking.status === 'CONFIRMED' && booking.transferAmountCents !== null
        ? booking.transferAmountCents + booking.creditAppliedCents
        : booking.status === 'CONFIRMED'
          ? booking.creditAppliedCents
          : 0

    const view = computeAccount({
      courtPriceCents: booking.slot.priceCents,
      lines: booking.bookingProducts.map(p => ({
        unitPriceCents: p.unitPriceCents,
        quantity: p.quantity,
        players: playersFromMask(p.playerMask),
      })),
      payments: booking.playerPayments,
      depositPaidCents,
      unassignedPaidCents: booking.localPaymentCents,
      settledAt: booking.settledAt,
    })
    return { view, settledAt: booking.settledAt }
  }

  /**
   * Records money collected at the front desk (cash / the club's QR) for a booking —
   * the missing piece for the daily cash closure. Amount 0 clears it.
   */
  async setLocalPayment(clubId: string, id: string, dto: LocalPaymentDto) {
    const booking = await this.prisma.booking.findFirst({ where: { id, clubId }, select: { id: true, status: true } })
    if (!booking) throw new NotFoundException('Reserva no encontrada')
    if (booking.status === 'CANCELLED') throw new BadRequestException('La reserva está cancelada')

    return this.prisma.booking.update({
      where: { id },
      data: {
        localPaymentCents: dto.amountCents,
        localPaymentMethod: dto.amountCents > 0 ? dto.method : null,
      },
      select: bookingSelect,
    })
  }

  async unmarkNoShow(clubId: string, id: string): Promise<void> {
    const booking = await this.prisma.booking.findFirst({
      where: { id, clubId },
      select: { id: true, noShowAt: true, playerId: true },
    })
    if (!booking) throw new NotFoundException('Reserva no encontrada')
    if (!booking.noShowAt) return

    await this.prisma.$transaction([
      this.prisma.booking.update({ where: { id }, data: { noShowAt: null } }),
      ...(booking.playerId
        ? [
            this.prisma.player.updateMany({
              where: { id: booking.playerId, noShowCount: { gt: 0 } },
              data: { noShowCount: { decrement: 1 } },
            }),
          ]
        : []),
    ])
  }

  /**
   * The MercadoPago identity this phone used on its most recent CONFIRMED transfer in this
   * club, if any. A "known" payer (paid at least once) can transfer a clean ROUND amount
   * and be reconciled by their stable `payer.id` — no centavos tag, no DNI prompt. We read
   * only CONFIRMED bookings so an unpaid/expected stamp never feeds back as if verified.
   */
  private async findKnownPayerIdentity(
    clubId: string,
    playerPhone?: string | null,
  ): Promise<{ mpUserId: string | null; cuit: string | null }> {
    if (!playerPhone) return { mpUserId: null, cuit: null }
    const prev = await this.prisma.booking.findFirst({
      where: { clubId, playerPhone, status: 'CONFIRMED', payerMpUserId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { payerMpUserId: true, payerCuit: true },
    })
    return { mpUserId: prev?.payerMpUserId ?? null, cuit: prev?.payerCuit ?? null }
  }

  /**
   * The amount a new pending booking asks for. A KNOWN payer (or a strict-DNI club) gets a
   * clean ROUND amount — reconciliation disambiguates by who paid (payer.id / DNI), so no
   * centavos tag is needed. A first-time payer gets the unique centavos-tagged amount, which
   * both guarantees a unique match and lets that first confirmation teach us their identity.
   */
  private async resolvePendingTransferAmount(
    tx: Prisma.TransactionClient,
    depositCents: number,
    roundAmount: boolean,
    known: { mpUserId: string | null },
  ): Promise<number> {
    // Round-amount modes (DNI / RECEIPT) or a known payer: a clean ROUND amount — the payer's
    // identity or a manual review disambiguates, so no centavos tag is needed. Only a brand-new
    // payer in default auto mode gets the unique centavos tag.
    if (roundAmount || known.mpUserId) return roundToWholePesos(depositCents)
    return this.allocateTransferAmount(tx, depositCents)
  }

  /**
   * Picks the exact amount the player must transfer so an incoming transfer maps to
   * exactly one pending booking. The centavos act as the unique identifier within a
   * whole-peso bucket. We PREFER the deposit's real amount (its own centavos) so the
   * player almost always transfers a clean number — only on a collision with another
   * pending booking in the same bucket do we pick a different free centavos tag (0-99).
   * Uniqueness is checked inside the caller's transaction. Falls back to the raw deposit
   * if all 100 tags are taken (manual confirmation then resolves the ambiguity).
   */
  private async allocateTransferAmount(tx: Prisma.TransactionClient, depositCents: number): Promise<number> {
    const wholePesos = Math.floor(depositCents / 100) * 100
    const preferredTag = depositCents - wholePesos // the deposit's real centavos (0-99)

    const taken = await tx.booking.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        transferAmountCents: { gte: wholePesos, lte: wholePesos + 99 },
      },
      select: { transferAmountCents: true },
    })
    const usedTags = new Set(taken.map(b => b.transferAmountCents! - wholePesos))

    // Prefer the exact deposit so most players transfer the clean, real amount.
    if (!usedTags.has(preferredTag)) return wholePesos + preferredTag

    // Collision: fall back to any other free centavos tag as the unique identifier.
    for (let tag = 0; tag <= 99; tag++) {
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
  async confirmPayment(bookingId: string, paymentRef?: string | null, payer?: PayerInfo): Promise<boolean> {
    const { count } = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: 'PENDING_PAYMENT' },
      data: {
        status: 'CONFIRMED',
        mpPaymentId: paymentRef ?? null,
        // Record who actually paid (visibility / audit) when MercadoPago exposed it.
        ...(payer?.cuit ? { payerCuit: payer.cuit } : {}),
        ...(payer?.email ? { payerEmail: payer.email } : {}),
        ...(payer?.mpUserId ? { payerMpUserId: payer.mpUserId } : {}),
      },
    })
    if (count === 0) return false

    // Persist the learned payment identity on the Player so future bookings
    // reconcile by payer without re-asking anything.
    if (payer?.mpUserId) {
      await this.prisma.player.updateMany({
        where: { bookings: { some: { id: bookingId } } },
        data: { payerMpUserId: payer.mpUserId },
      })
    }

    // The receipt screenshot (if any) is no longer needed once the payment is confirmed.
    await this.purgeReceipts(bookingId)

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        clubId: true,
        playerName: true,
        slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
      },
    })
    if (booking) {
      const { startsAt, endsAt, court } = booking.slot
      // A dedicated "payment confirmed" event (not a generic booking.changed) so the panel can
      // ring the cash alert on every confirmation — automatic (poller) or manual.
      this.events.emitPaymentConfirmed({
        type: 'payment.confirmed',
        clubId: booking.clubId,
        summary: `${booking.playerName} · ${court.name} · ${formatDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}`,
        source: paymentRef ? 'AUTO' : 'MANUAL',
      })
    }

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
   *
   * `clubId` scopes the match to a single club: pass it when the transfer was read
   * from that club's OWN MercadoPago account (so a movement can only confirm that
   * club's bookings). Omit it for the shared/legacy account, where amounts are unique
   * globally across all clubs sharing it.
   */
  async confirmPaymentByAmount(
    amountCents: number,
    paymentRef: string,
    paidAt: Date,
    clubId?: string,
    payer?: PayerInfo,
  ): Promise<string | null> {
    // Single-use transfer: a given MercadoPago movement can confirm at most ONE booking.
    // Without this, two same-amount bookings could each be confirmed by the same transfer
    // on successive poll ticks (the poller re-scans recent movements every tick).
    const alreadyUsed = await this.prisma.booking.findFirst({
      where: { mpPaymentId: paymentRef },
      select: { id: true },
    })
    if (alreadyUsed) return null

    const candidates = await this.prisma.booking.findMany({
      where: {
        ...(clubId ? { clubId } : {}),
        // Never auto-confirm a RECEIPT-mode booking — those are verified by hand from the panel.
        club: { paymentVerificationMode: 'AUTO' },
        status: 'PENDING_PAYMENT',
        transferAmountCents: amountCents,
        createdAt: { lte: paidAt },
        paymentExpiresAt: { gte: paidAt },
      },
      select: { id: true, playerDni: true, payerMpUserId: true },
    })

    if (candidates.length === 0) {
      // Race expiración-vs-pago: the player transferred INSIDE the window but the
      // expiry cron cancelled the pending before this poll tick saw the money.
      // The transfer is real and on time — try to revive the booking.
      return this.reviveExpiredCandidate(amountCents, paymentRef, paidAt, clubId, payer)
    }

    // Strict mode (per club): only auto-confirm when the payer's DNI matches the
    // reservation's. The amount is round (no centavos tag), so several bookings can share
    // it — the DNI is the disambiguator.
    const requireDni = clubId ? await this.clubRequiresDniMatch(clubId) : false
    if (requireDni) {
      const payerDni = dniFromIdentification(payer?.cuit)
      if (!payerDni) {
        this.logger.warn(
          `Transfer ${paymentRef} (${amountCents} cents) has no usable payer DNI but the club requires it — manual review`,
        )
        return null
      }
      const matched = candidates.filter(c => dniMatches(c.playerDni, payerDni))
      if (matched.length !== 1) {
        this.logger.warn(
          `Transfer ${paymentRef}: payer DNI matched ${matched.length} of ${candidates.length} pending bookings — manual review`,
        )
        return null
      }
      const confirmed = await this.confirmPayment(matched[0].id, paymentRef, payer)
      return confirmed ? matched[0].id : null
    }

    // Default mode: a unique centavos-tagged amount yields a single candidate (first-time
    // payer) → confirm directly. When a clean ROUND amount is shared by several known
    // payers, the incoming payer's identity (MercadoPago id, or DNI from the CUIT) picks
    // the right one. Only confirm on an unambiguous result — never auto-confirm otherwise.
    const chosen = this.disambiguateByPayer(candidates, payer)
    if (!chosen) {
      this.logger.warn(
        `Transfer of ${amountCents} cents matched ${candidates.length} pending bookings (ref ${paymentRef}) — needs manual review`,
      )
      return null
    }

    const confirmed = await this.confirmPayment(chosen.id, paymentRef, payer)
    return confirmed ? chosen.id : null
  }

  /**
   * Handles the expiry-vs-payment race: a transfer made within the payment window that
   * the poller only sees AFTER `cleanupExpiredPending` already cancelled the booking
   * (e.g. paid at minute 29, cancelled at 30, polled at 32). The money is real and on
   * time, so if the slot is still free we atomically re-take it and confirm; if someone
   * else grabbed the slot in between, we log loudly for manual resolution (refund).
   */
  private async reviveExpiredCandidate(
    amountCents: number,
    paymentRef: string,
    paidAt: Date,
    clubId?: string,
    payer?: PayerInfo,
  ): Promise<string | null> {
    const candidates = await this.prisma.booking.findMany({
      where: {
        ...(clubId ? { clubId } : {}),
        club: { paymentVerificationMode: 'AUTO' },
        // Cancelled by expiry, never paid: no payment ref and no explicit deposit outcome.
        status: 'CANCELLED',
        mpPaymentId: null,
        depositOutcome: null,
        transferAmountCents: amountCents,
        createdAt: { lte: paidAt },
        paymentExpiresAt: { gte: paidAt },
      },
      select: { id: true, slotId: true, playerDni: true, payerMpUserId: true },
    })
    if (candidates.length === 0) return null

    const requireDni = clubId ? await this.clubRequiresDniMatch(clubId) : false
    let chosen: (typeof candidates)[number] | null
    if (requireDni) {
      const payerDni = dniFromIdentification(payer?.cuit)
      const matched = payerDni ? candidates.filter(c => dniMatches(c.playerDni, payerDni)) : []
      chosen = matched.length === 1 ? matched[0] : null
    } else {
      chosen = this.disambiguateByPayer(candidates, payer)
    }
    if (!chosen) return null

    // Atomically re-take the slot; if it's gone, the money needs a human (refund).
    const { count } = await this.prisma.slot.updateMany({
      where: { id: chosen.slotId, status: SlotStatus.AVAILABLE },
      data: { status: SlotStatus.BOOKED },
    })
    if (count !== 1) {
      this.logger.error(
        `Transfer ${paymentRef} (${amountCents} cents) arrived in-window for expired booking ${chosen.id}, ` +
          `but the slot was already re-taken — REFUND NEEDED (manual)`,
      )
      return null
    }

    // Revive to PENDING so the normal confirm path (events, receipts, identity) applies.
    await this.prisma.booking.update({ where: { id: chosen.id }, data: { status: 'PENDING_PAYMENT' } })
    const confirmed = await this.confirmPayment(chosen.id, paymentRef, payer)
    if (confirmed) {
      this.logger.log(`Revived expired booking ${chosen.id} — transfer ${paymentRef} was made in-window`)
      return chosen.id
    }
    return null
  }

  /**
   * Picks the single pending booking an incoming transfer belongs to, returning null when it
   * stays ambiguous (left for manual review). Two kinds of pending booking coexist:
   *  - First-time payer: a unique centavos-tagged amount and NO expected identity — the amount
   *    itself is the identifier, so it matches on amount alone.
   *  - Known payer: a clean ROUND amount (shared with other known payers) plus a stamped
   *    expected identity — since a round amount is not unique, it confirms ONLY when the
   *    incoming payer matches (MercadoPago id, then DNI). This guards against a stranger's
   *    same-round-amount transfer ever confirming someone else's booking.
   */
  private disambiguateByPayer<T extends { playerDni: string | null; payerMpUserId: string | null }>(
    candidates: T[],
    payer?: PayerInfo,
  ): T | null {
    const payerMpUserId = payer?.mpUserId ?? null
    const payerDni = dniFromIdentification(payer?.cuit)
    const identityMatches = (c: T): boolean =>
      (payerMpUserId !== null && c.payerMpUserId === payerMpUserId) || dniMatches(c.playerDni, payerDni)

    const eligible = candidates.filter(c => {
      const expectsIdentity = c.payerMpUserId !== null || c.playerDni !== null
      return expectsIdentity ? identityMatches(c) : true
    })
    return eligible.length === 1 ? eligible[0] : null
  }

  /** Whether the club requires DNI-matched auto-confirmation. */
  private async clubRequiresDniMatch(clubId: string): Promise<boolean> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { requireDniMatch: true } })
    return club?.requireDniMatch ?? false
  }

  /**
   * The DNI this phone used on its most recent booking in this club, if any. Lets the
   * bot pre-fill the DNI in requireDniMatch mode so a returning player is never asked
   * for it twice — the round transfer amount stays clean and the UX stays frictionless.
   */
  async findKnownDniForPhone(clubId: string, playerPhone: string): Promise<string | null> {
    const booking = await this.prisma.booking.findFirst({
      where: { clubId, playerPhone, playerDni: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { playerDni: true },
    })
    return booking?.playerDni ?? null
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

  // ── Player self-service (the bot's "Mis turnos") ────────────────────────────

  /**
   * The player's upcoming bookings, newest first — what the bot lists under "Mis turnos".
   * Scoped to their own phone: a player can only ever see their own reservations.
   */
  findUpcomingForPlayer(clubId: string, playerPhone: string, limit = 9) {
    return this.prisma.booking.findMany({
      where: {
        clubId,
        playerPhone,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
        slot: { startsAt: { gte: new Date() } },
      },
      orderBy: { slot: { startsAt: 'asc' } },
      take: limit,
      select: {
        id: true,
        status: true,
        transferAmountCents: true,
        creditAppliedCents: true,
        slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
      },
    })
  }

  /**
   * What the player is allowed to do with a booking they can't make it to.
   *
   * The bot never cancels: it MOVES the booking. Rescheduling keeps the deposit alive on the
   * same booking, frees the old court for the waitlist to resell, and takes no money out of
   * the club — which is why it can be self-service at all. A real cancellation moves money,
   * so it stays a decision of the club, in the panel.
   *
   * Returns how this particular booking may be moved, right now:
   *   SELF    → the bot can move it.
   *   REQUEST → a human decides (club policy, past the cutoff, or the cap is used up).
   *   OFF     → the club doesn't offer it at all.
   * Null = not this player's booking (this is also the ownership check for the move below).
   */
  async reschedulePolicyForPlayer(
    clubId: string,
    bookingId: string,
    playerPhone: string,
  ): Promise<{
    mode: PlayerRescheduleMode
    /** Why it isn't SELF, when the club's own setting would have allowed it. */
    reason: 'ok' | 'club-policy' | 'too-late' | 'limit-reached'
    cutoffHours: number | null
    startsAt: Date
    courtName: string
    priceCents: number
  } | null> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clubId, playerPhone, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
      select: {
        rescheduleCount: true,
        slot: { select: { startsAt: true, priceCents: true, court: { select: { name: true } } } },
      },
    })
    if (!booking) return null

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { playerReschedule: true, playerRescheduleCutoffHours: true, maxPlayerReschedules: true },
    })
    const configured = club?.playerReschedule ?? PlayerRescheduleMode.SELF
    const cutoffHours = club?.playerRescheduleCutoffHours ?? null
    const base = {
      cutoffHours,
      startsAt: booking.slot.startsAt,
      courtName: booking.slot.court.name,
      priceCents: booking.slot.priceCents,
    }

    if (configured !== PlayerRescheduleMode.SELF) {
      return { mode: configured, reason: 'club-policy', ...base }
    }

    // Used up their moves → a human decides, rather than a flat "no".
    if (booking.rescheduleCount >= (club?.maxPlayerReschedules ?? 1)) {
      return { mode: PlayerRescheduleMode.REQUEST, reason: 'limit-reached', ...base }
    }

    // Too close to the start: a court freed now can't be resold, so it isn't ours to give away.
    if (cutoffHours !== null) {
      const hoursAhead = (booking.slot.startsAt.getTime() - Date.now()) / 3_600_000
      if (hoursAhead < cutoffHours) {
        return { mode: PlayerRescheduleMode.REQUEST, reason: 'too-late', ...base }
      }
    }

    return { mode: PlayerRescheduleMode.SELF, reason: 'ok', ...base }
  }

  /**
   * Moves a player's booking to another band, from WhatsApp.
   *
   * The booking keeps its identity — same row, same deposit, same status — so nothing has to
   * be refunded and nothing has to be re-paid. Only the slot changes. The old court is freed
   * and broadcast, which is what lets the waitlist resell the hour the player gave back.
   *
   * The whole move is one transaction: taking the new slot and releasing the old one cannot
   * half-happen, or the player ends up with two courts or none. `null` = the move is no longer
   * possible (someone took the target band first, or the booking changed underneath us).
   */
  async rescheduleToBandByPlayer(
    clubId: string,
    bookingId: string,
    playerPhone: string,
    target: { courtId: string; dateKey: string; bandStart: string },
  ): Promise<{ priceDiffCents: number; newPriceCents: number } | null> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clubId, playerPhone, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
      select: { id: true, slotId: true, status: true, slot: { select: { priceCents: true } } },
    })
    if (!booking) return null

    const court = await this.prisma.court.findFirst({
      where: { id: target.courtId, clubId },
      select: {
        priceCents: true,
        ...courtScheduleSelect,
        priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
      },
    })
    if (!court) return null

    const band = findBandInSchedule(bandsForDate(court, target.dateKey), target.bandStart)
    if (!band) return null

    const { startsAt, endsAt } = bandDateTimes(target.dateKey, band)
    if (startsAt.getTime() <= Date.now()) return null

    const newPriceCents = resolveBandPriceCents(court.priceCents, court.priceRules, target.dateKey, band.start)

    try {
      const updated = await this.prisma.$transaction(async tx => {
        // Take the new slot first: if it's gone, we roll back and the player keeps the old one.
        const existing = await tx.slot.findFirst({
          where: { clubId, courtId: target.courtId, startsAt },
          select: { id: true },
        })
        const newSlotId = existing
          ? (await this.lockSlotOrThrow(tx, existing.id, clubId), existing.id)
          : await this.createBookedSlot(tx, {
              clubId,
              courtId: target.courtId,
              startsAt,
              endsAt,
              priceCents: newPriceCents,
            })

        // Conditional on the booking still sitting where we read it: the expiry cron or an
        // admin may have moved/cancelled it while the player was choosing a new hour.
        const { count } = await tx.booking.updateMany({
          where: { id: bookingId, slotId: booking.slotId, status: booking.status },
          data: {
            slotId: newSlotId,
            // The reminder was scheduled against the old time; let it be re-evaluated.
            reminderSentAt: null,
            rescheduleCount: { increment: 1 },
          },
        })
        if (count !== 1) throw new ConflictException('La reserva cambió mientras la movíamos')

        await tx.slot.update({ where: { id: booking.slotId }, data: { status: SlotStatus.AVAILABLE } })
        return tx.booking.findUnique({ where: { id: bookingId }, select: bookingSelect })
      })

      if (!updated) return null

      this.emitBookingChange('rescheduled', updated)
      // The hour the player gave back — back on sale at today's price, then offered to
      // whoever is waiting for it.
      await this.slotPricing.repriceSlot(booking.slotId, clubId)
      const freed = await this.prisma.slot.findUnique({
        where: { id: booking.slotId },
        select: { startsAt: true, endsAt: true, priceCents: true, court: { select: { id: true, name: true } } },
      })
      if (freed) {
        this.events.emitSlotFreed({
          type: 'slot.freed',
          clubId,
          courtId: freed.court.id,
          courtName: freed.court.name,
          startsAt: freed.startsAt,
          endsAt: freed.endsAt,
          priceCents: freed.priceCents,
        })
      }

      return { priceDiffCents: newPriceCents - booking.slot.priceCents, newPriceCents }
    } catch (err) {
      if (err instanceof ConflictException) return null
      throw err
    }
  }

  // ── Receipt-photo flow (RECEIPT verification mode) ──────────────────────────

  /**
   * Records a transfer-receipt image for a pending booking (RECEIPT mode): persists the
   * PaymentReceipt row, stamps `receiptUploadedAt` (which both prioritizes the booking in the
   * panel and stops it from auto-expiring while awaiting review), and emits a `payment.receipt`
   * event so connected admins are alerted live. The bytes are already in storage; only metadata
   * is stored here.
   */
  async attachReceipt(
    clubId: string,
    bookingId: string,
    file: { storageKey: string; url: string; mimeType: string; sizeBytes: number; waMediaId?: string | null },
  ): Promise<void> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clubId },
      select: {
        id: true,
        playerName: true,
        slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
      },
    })
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`)

    await this.prisma.$transaction([
      this.prisma.paymentReceipt.create({
        data: {
          bookingId,
          clubId,
          storageKey: file.storageKey,
          url: file.url,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          waMediaId: file.waMediaId ?? null,
        },
      }),
      this.prisma.booking.update({ where: { id: bookingId }, data: { receiptUploadedAt: new Date() } }),
    ])

    const { startsAt, endsAt, court } = booking.slot
    const summary = `${booking.playerName} · ${court.name} · ${formatDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}`
    this.events.emitReceipt({ type: 'payment.receipt', clubId, bookingId, summary })
    void this.notifications.notifyClub(clubId, {
      title: 'Nuevo comprobante para revisar',
      body: summary,
      data: { bookingId },
    })
  }

  /** The most recent receipt for a booking (club-scoped) — used to serve the image to the panel. */
  async getLatestReceipt(clubId: string, bookingId: string) {
    const receipt = await this.prisma.paymentReceipt.findFirst({
      where: { bookingId, clubId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, storageKey: true, mimeType: true },
    })
    if (!receipt) throw new NotFoundException('Receipt not found')
    return receipt
  }

  /**
   * Deletes a booking's receipt images from storage and the DB. Called once the payment is
   * resolved (confirmed/rejected/expired) — the screenshot is no longer needed. Best-effort:
   * a storage failure never blocks the booking transition.
   */
  private async purgeReceipts(bookingId: string): Promise<void> {
    const receipts = await this.prisma.paymentReceipt.findMany({
      where: { bookingId },
      select: { id: true, url: true, storageKey: true },
    })
    if (receipts.length === 0) return
    for (const r of receipts) {
      await this.receiptStorage.delete(r)
    }
    await this.prisma.paymentReceipt.deleteMany({ where: { bookingId } })
  }

  /**
   * Manual confirmation from the admin panel (front-desk verified the money landed).
   * Club-scoped and idempotent. Returns the booking id when it flips a pending
   * booking to CONFIRMED, or null if it was already processed.
   */
  async confirmPaymentManual(
    clubId: string,
    bookingId: string,
    payment?: { paymentRef?: string | null; payer?: PayerInfo },
  ): Promise<string | null> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, clubId },
      select: {
        id: true,
        status: true,
        bookedByUserId: true,
        _count: { select: { receipts: true } },
        club: { select: { paymentVerificationMode: true } },
      },
    })
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`)
    if (booking.status !== 'PENDING_PAYMENT') return null

    const paymentRef = payment?.paymentRef ?? null
    if (paymentRef) {
      // Single-use, same as the poller: one MercadoPago movement confirms ONE booking.
      const used = await this.prisma.booking.findFirst({ where: { mpPaymentId: paymentRef }, select: { id: true } })
      if (used) throw new BadRequestException('Esa transferencia ya confirmó otra reserva')
    }

    // Admin-created bookings are confirmed at the desk without a player receipt.
    // Only bot-initiated bookings (bookedByUserId === null) require the receipt in RECEIPT
    // mode — unless a concrete detected transfer is being assigned (the money IS verified).
    const isAdminBooking = booking.bookedByUserId !== null
    if (
      booking.club.paymentVerificationMode === 'RECEIPT' &&
      booking._count.receipts === 0 &&
      !isAdminBooking &&
      !paymentRef
    ) {
      throw new BadRequestException('No se puede confirmar la reserva sin un comprobante adjunto')
    }

    const confirmed = await this.confirmPayment(bookingId, paymentRef, payment?.payer)
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
        playerId: true,
        creditAppliedCents: true,
        clubId: true,
        playerName: true,
        slot: {
          select: { startsAt: true, endsAt: true, priceCents: true, court: { select: { id: true, name: true } } },
        },
      },
    })
    if (!booking || booking.status !== 'PENDING_PAYMENT') return null
    // Still PENDING a moment ago — but the poller may confirm it before we write.
    if (!(await this.releasePendingSlot(booking))) return null

    // Drop the receipt screenshot (if any) — the booking is no longer pending.
    await this.purgeReceipts(bookingId)

    this.emitBookingChange('cancelled', booking)
    this.events.emitSlotFreed({
      type: 'slot.freed',
      clubId: booking.clubId,
      courtId: booking.slot.court.id,
      courtName: booking.slot.court.name,
      startsAt: booking.slot.startsAt,
      endsAt: booking.slot.endsAt,
      priceCents: booking.slot.priceCents,
    })
    return { playerPhone: booking.playerPhone, clubId: booking.clubId }
  }

  /**
   * Flips ONE booking to CANCELLED and releases its slot — but only if it is *still*
   * PENDING_PAYMENT at write time. The conditional `updateMany` is the whole point: between
   * the read that selected this booking and this write, the payment poller may have
   * CONFIRMED it (the player transferred inside the window and MercadoPago reported the
   * movement late — the poller scans with a grace margin precisely for that). An
   * unconditional update would then un-confirm a booking the player already paid and was
   * told was confirmed, and hand their court to somebody else.
   *
   * Returns false when the booking is no longer pending — nothing was touched.
   */
  private async releasePendingSlot(booking: {
    id: string
    slotId: string
    playerId: string | null
    creditAppliedCents: number
  }): Promise<boolean> {
    const released = await this.prisma.$transaction(async tx => {
      const { count } = await tx.booking.updateMany({
        where: { id: booking.id, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED' },
      })
      if (count !== 1) {
        this.logger.warn(`Booking ${booking.id} was confirmed while being cancelled — left untouched`)
        return false
      }
      await tx.slot.update({ where: { id: booking.slotId }, data: { status: SlotStatus.AVAILABLE } })
      // Nothing was paid — give back the credit this pending had consumed.
      if (booking.playerId && booking.creditAppliedCents > 0) {
        await tx.player.update({
          where: { id: booking.playerId },
          data: { creditCents: { increment: booking.creditAppliedCents } },
        })
      }
      return true
    })

    // The band is on sale again: quote it at today's price, not the one the abandoned hold had.
    if (released) await this.slotPricing.repriceSlot(booking.slotId)
    return released
  }

  /**
   * Finds all PENDING_PAYMENT bookings whose payment link has expired,
   * cancels them, and releases their slots.
   */
  async findAndCancelExpiredPending(): Promise<CancelledPendingInfo[]> {
    const expired = await this.prisma.booking.findMany({
      // A booking whose receipt photo already arrived is NOT auto-cancelled: the player paid
      // and is waiting on the admin's manual review, which may take longer than the window.
      where: { status: 'PENDING_PAYMENT', paymentExpiresAt: { lt: new Date() }, receiptUploadedAt: null },
      select: {
        id: true,
        slotId: true,
        playerPhone: true,
        playerId: true,
        creditAppliedCents: true,
        clubId: true,
        playerName: true,
        slot: {
          select: { startsAt: true, endsAt: true, priceCents: true, court: { select: { id: true, name: true } } },
        },
      },
    })

    const results: CancelledPendingInfo[] = []

    for (const booking of expired) {
      try {
        // The transfer may have landed between the read above and this write.
        if (!(await this.releasePendingSlot(booking))) continue
        this.emitBookingChange('cancelled', booking)
        this.events.emitSlotFreed({
          type: 'slot.freed',
          clubId: booking.clubId,
          courtId: booking.slot.court.id,
          courtName: booking.slot.court.name,
          startsAt: booking.slot.startsAt,
          endsAt: booking.slot.endsAt,
          priceCents: booking.slot.priceCents,
        })
        results.push({ playerPhone: booking.playerPhone, clubId: booking.clubId })
      } catch (err) {
        this.logger.error(`Failed to cancel expired booking ${booking.id}`, err)
      }
    }

    return results
  }

  // ── Booking products (consumos) ─────────────────────────────────────────────

  /**
   * Replaces all products associated with a booking in a single transaction.
   * Passing an empty items array clears all consumos. Club-scoped.
   */
  async setBookingProducts(clubId: string, bookingId: string, dto: SetBookingProductsDto) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, clubId }, select: { id: true } })
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`)

    if (dto.items.length > 0) {
      const productIds = dto.items.map(i => i.productId)
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds }, clubId },
        select: { id: true, priceCents: true },
      })
      const priceMap = new Map(products.map(p => [p.id, p.priceCents]))
      const missing = productIds.filter(id => !priceMap.has(id))
      if (missing.length > 0) throw new NotFoundException(`Productos no encontrados: ${missing.join(', ')}`)

      await this.prisma.$transaction([
        this.prisma.bookingProduct.deleteMany({ where: { bookingId } }),
        this.prisma.bookingProduct.createMany({
          data: dto.items.map(item => ({
            bookingId,
            productId: item.productId,
            clubId,
            quantity: item.quantity,
            unitPriceCents: priceMap.get(item.productId)!,
            playerMask: item.players.reduce((mask, player) => mask | (1 << (player - 1)), 0),
          })),
        }),
      ])
    } else {
      await this.prisma.bookingProduct.deleteMany({ where: { bookingId } })
    }

    return this.findOne(clubId, bookingId)
  }

  /**
   * Broadcasts a booking change to the club's connected admins (live dashboard) and, for a new
   * booking, pushes a notification to the staff app so someone checks it even with the app
   * closed. Best-effort: neither ever blocks or fails the booking itself.
   */
  private emitBookingChange(action: BookingAction, booking: BookingForEvent): void {
    const { startsAt, endsAt, court } = booking.slot
    const summary = `${booking.playerName} · ${court.name} · ${formatDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}`
    this.events.emit({ type: 'booking.changed', clubId: booking.clubId, action, summary })

    if (action === 'created') {
      void this.notifications.notifyClub(booking.clubId, {
        title: 'Nueva reserva pendiente de seña',
        body: summary,
        data: { bookingId: booking.id },
      })
    }
  }
}

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateBookingDto } from './dto/create-booking.dto'
import { RescheduleBookingDto } from './dto/reschedule-booking.dto'
import { QueryBookingsDto } from './dto/query-bookings.dto'
import { Prisma, SlotStatus } from 'generated/prisma/client'
import { bandDateTimes, findBandInSchedule, generateBands } from '../availability/lib/schedule'
import { resolveBandPriceCents } from '../availability/lib/pricing'
import { dniFromIdentification, dniMatches } from '../common/identity'
import { formatDayMonth, formatTimeRange } from '../availability/lib/datetime'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { BookingAction, BookingEventsService } from '../events/booking-events.service'
import { ReceiptStorageService } from '../storage/receipt-storage.service'

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
  recurringBookingId: true,
  bookedByUserId: true,
  depositCents: true,
  transferAmountCents: true,
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
} as const

/** Shape needed to build an event summary — satisfied by any `bookingSelect` row. */
type BookingForEvent = {
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

/** Default seña percentage (one of four padel players) when a club has none set. */
const DEFAULT_DEPOSIT_PERCENT = 25
/** Rounds a cents amount to whole pesos — the clean amount a known payer transfers. */
const roundToWholePesos = (cents: number): number => Math.round(cents / 100) * 100
/** Minutes a player has to transfer before the pending booking auto-cancels (env-tunable). */
const PAYMENT_WINDOW_MS = (Number(process.env.PAYMENT_WINDOW_MIN) || 30) * 60 * 1000

export interface PendingBookingResult {
  id: string
  depositCents: number
  /** Exact amount (cents) the player must transfer — unique among pending bookings. */
  transferAmountCents: number
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
  ) {}

  async findAll(clubId: string, query: QueryBookingsDto) {
    const bookings = await this.prisma.booking.findMany({
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
    return bookings.map(withReceiptFlag)
  }

  async findOne(clubId: string, id: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, clubId },
      select: bookingSelect,
    })
    if (!booking) throw new NotFoundException(`Booking ${id} not found`)
    return withReceiptFlag(booking)
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

    const booking = await this.prisma.$transaction(async tx => {
      // Atomic check-and-lock: only the writer that flips AVAILABLE→BOOKED proceeds.
      await this.lockSlotOrThrow(tx, dto.slotId, clubId)
      return tx.booking.create({
        data: {
          slotId: dto.slotId,
          clubId,
          playerName: dto.playerName,
          playerPhone: dto.playerPhone ?? null,
          notes: dto.notes,
          bookedByUserId: bookedByUserId ?? null,
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
      if (isUniqueConstraintError(error)) throw new ConflictException('Slot is not available')
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
        openTime: true,
        closeTime: true,
        priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
      },
    })
    if (!court) throw new NotFoundException(`Court ${input.courtId} not found`)

    const bands = generateBands(court.openTime, court.closeTime)
    const band = findBandInSchedule(bands, input.bandStart)
    if (!band) throw new BadRequestException(`Invalid slot band ${input.bandStart}`)

    const { startsAt, endsAt } = bandDateTimes(input.dateKey, band)
    if (startsAt.getTime() <= Date.now()) {
      throw new ConflictException('Cannot book a slot in the past')
    }

    const bandPriceCents = resolveBandPriceCents(court.priceCents, court.priceRules, input.dateKey, band.start)

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

    const updated = await this.prisma.$transaction(async tx => {
      await tx.slot.update({ where: { id: booking.slotId }, data: { status: SlotStatus.AVAILABLE } })
      // Atomic lock on the target slot: if another reschedule/booking took it first, the
      // whole transaction (including the release above) rolls back cleanly.
      await this.lockSlotOrThrow(tx, dto.newSlotId, clubId)
      return tx.booking.update({ where: { id }, data: { slotId: dto.newSlotId }, select: bookingSelect })
    })

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

    const { depositCents, roundAmount } = await this.resolvePaymentPlan(clubId, slot.priceCents)
    const known = await this.findKnownPayerIdentity(clubId, dto.playerPhone)
    const paymentExpiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS)

    const booking = await this.prisma.$transaction(async tx => {
      // Atomic check-and-lock — the loser of a concurrent race gets a clean conflict.
      await this.lockSlotOrThrow(tx, dto.slotId, clubId)
      const transferAmountCents = await this.resolvePendingTransferAmount(tx, depositCents, roundAmount, known)

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
      select: {
        priceCents: true,
        openTime: true,
        closeTime: true,
        priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
      },
    })
    if (!court) throw new NotFoundException(`Court ${input.courtId} not found`)

    const bands = generateBands(court.openTime, court.closeTime)
    const band = findBandInSchedule(bands, input.bandStart)
    if (!band) throw new BadRequestException(`Invalid slot band ${input.bandStart}`)

    const { startsAt, endsAt } = bandDateTimes(input.dateKey, band)
    if (startsAt.getTime() <= Date.now()) throw new ConflictException('Cannot book a slot in the past')

    const bandPriceCents = resolveBandPriceCents(court.priceCents, court.priceRules, input.dateKey, band.start)
    const { depositCents, roundAmount } = await this.resolvePaymentPlan(clubId, bandPriceCents)
    const known = await this.findKnownPayerIdentity(clubId, input.playerPhone)
    const paymentExpiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS)

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

      const transferAmountCents = await this.resolvePendingTransferAmount(tx, depositCents, roundAmount, known)

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

    if (candidates.length === 0) return null

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
    this.events.emitReceipt({
      type: 'payment.receipt',
      clubId,
      bookingId,
      summary: `${booking.playerName} · ${court.name} · ${formatDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}`,
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

    // Drop the receipt screenshot (if any) — the booking is no longer pending.
    await this.purgeReceipts(bookingId)

    this.emitBookingChange('cancelled', booking)
    return { playerPhone: booking.playerPhone, clubId: booking.clubId }
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

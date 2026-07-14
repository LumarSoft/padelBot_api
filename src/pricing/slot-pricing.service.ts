import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { resolveBandPriceCents } from '../availability/lib/pricing'
import { formatTime, toDateKey } from '../availability/lib/datetime'

/** Bookings that already put money in (or hold a live quote) freeze their slot's price. */
const bookingSelect = {
  status: true,
  transferAmountCents: true,
  creditAppliedCents: true,
  localPaymentCents: true,
  playerPayments: { select: { id: true }, take: 1 },
  // A turno fijo is sold at the price agreed with the player, not at the list price.
  recurringBooking: { select: { priceCents: true } },
} as const

interface SlotBooking {
  status: string
  transferAmountCents: number | null
  creditAppliedCents: number
  localPaymentCents: number
  playerPayments: { id: string }[]
  recurringBooking: { priceCents: number } | null
}

/**
 * Keeps `Slot.priceCents` — the snapshot the panel and the bot quote from — in sync with the
 * club's price list (court default + `CourtPriceRule` exceptions).
 *
 * A slot's price is a snapshot on purpose: what the player was quoted is what they pay. But the
 * snapshot must only outlive a price change when the turno was actually *sold* at the old price.
 * A turno the club still has to charge — free, blocked, freed by a cancellation, or a turno fijo
 * still to be played — follows the new price list. Without this, raising prices left the agenda
 * quoting last month's numbers on every materialized slot.
 */
@Injectable()
export class SlotPricingService {
  private readonly logger = new Logger(SlotPricingService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * True when the turno was already sold at its current price: a live transfer quote
   * (PENDING_PAYMENT), a paid seña, consumed credit, or any money taken at the mostrador.
   * Repricing those would move the goalposts under money that already changed hands.
   */
  private isSold(booking: SlotBooking): boolean {
    if (booking.status === 'PENDING_PAYMENT') return true
    return (
      booking.transferAmountCents !== null ||
      booking.creditAppliedCents > 0 ||
      booking.localPaymentCents > 0 ||
      booking.playerPayments.length > 0
    )
  }

  /**
   * The price a slot should carry today: the turno fijo's agreed price when one occupies it
   * (that number is the deal with the player — `CourtsService` moves it when the list moves),
   * otherwise the court's list price for that band.
   */
  private targetPriceCents(
    bookings: SlotBooking[],
    startsAt: Date,
    court: { priceCents: number; priceRules: { dayOfWeek: number | null; startTime: string; priceCents: number }[] },
  ): number | null {
    const active = bookings.filter(b => b.status !== 'CANCELLED')
    if (active.some(b => this.isSold(b))) return null

    const fijo = active.find(b => b.recurringBooking !== null)?.recurringBooking
    if (fijo) return fijo.priceCents

    return resolveBandPriceCents(court.priceCents, court.priceRules, toDateKey(startsAt), formatTime(startsAt))
  }

  /**
   * Re-prices every future slot of the club (optionally a single court) against the current
   * price list. Returns how many slots changed. Past slots are history — never touched.
   */
  async repriceFutureSlots(clubId: string, courtId?: string): Promise<number> {
    const courts = await this.prisma.court.findMany({
      where: { clubId, ...(courtId ? { id: courtId } : {}) },
      select: {
        id: true,
        priceCents: true,
        priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
      },
    })
    if (courts.length === 0) return 0

    const slots = await this.prisma.slot.findMany({
      where: {
        clubId,
        courtId: { in: courts.map(c => c.id) },
        startsAt: { gt: new Date() },
      },
      select: {
        id: true,
        courtId: true,
        startsAt: true,
        priceCents: true,
        bookings: { select: bookingSelect },
      },
    })

    const priceListByCourt = new Map(courts.map(c => [c.id, c]))
    const changes: { id: string; priceCents: number }[] = []

    for (const slot of slots) {
      const court = priceListByCourt.get(slot.courtId)
      if (!court) continue
      const priceCents = this.targetPriceCents(slot.bookings, slot.startsAt, court)
      if (priceCents !== null && priceCents !== slot.priceCents) changes.push({ id: slot.id, priceCents })
    }

    for (const change of changes) {
      await this.prisma.slot.update({ where: { id: change.id }, data: { priceCents: change.priceCents } })
    }
    if (changes.length > 0) {
      this.logger.log(`Repriced ${changes.length} future slot(s) for club ${clubId}`)
    }
    return changes.length
  }

  /**
   * Re-prices one slot against the current price list and returns the price it ends up with
   * (null when the slot is gone). Used when a band goes back on sale — a cancellation, a
   * rejected payment, a reschedule — so the freed cell quotes today's price and not the one
   * the reservation that just went away had been sold at.
   */
  async repriceSlot(slotId: string, clubId?: string): Promise<number | null> {
    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId, ...(clubId ? { clubId } : {}) },
      select: {
        id: true,
        startsAt: true,
        priceCents: true,
        bookings: { select: bookingSelect },
        court: {
          select: {
            priceCents: true,
            priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
          },
        },
      },
    })
    if (!slot) return null

    const priceCents = this.targetPriceCents(slot.bookings, slot.startsAt, slot.court)
    if (priceCents === null) return slot.priceCents
    if (priceCents !== slot.priceCents) {
      await this.prisma.slot.update({ where: { id: slot.id }, data: { priceCents } })
    }
    return priceCents
  }
}

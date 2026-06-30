import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { BandOption, SlotOption } from '../bot/types'
import { dayRangeUtc, formatTimeRange, shiftDateKey, toDateKey } from './lib/datetime'
import { bandDateTimes, generateBands } from './lib/schedule'
import { resolveBandPriceCents } from './lib/pricing'

/** A date that has at least one bookable band, with how many are free. */
export interface AvailableDate {
  dateKey: string
  count: number
}

/**
 * Single source of truth for "what can a player book", using the open-by-default
 * model: every schedule band on every court is bookable unless a Slot row marks
 * it BOOKED or BLOCKED. This mirrors the admin agenda grid, which renders the
 * full schedule and materializes a Slot only when a cell is actually booked.
 * Day windows are computed in the club timezone so results are correct on any host.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The day's free bands across every court, each carrying the courts that are free at it.
   * This is the single, fresh source for the time-first booking flow: a band only appears
   * with the courts that are actually AVAILABLE right now, so the bot never offers a time on
   * a court that is already booked/blocked. Bands are sorted by start time.
   */
  async availableBandsForDate(clubId: string, dateKey: string): Promise<BandOption[]> {
    const courts = await this.prisma.court.findMany({
      where: { clubId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    if (courts.length === 0) return []

    const byBand = new Map<string, BandOption>()
    for (const court of courts) {
      const slots = await this.slotsForDate(clubId, dateKey, court.id)
      for (const s of slots) {
        const entry = byBand.get(s.bandStart) ?? { bandStart: s.bandStart, label: s.label, courts: [] }
        entry.courts.push({ id: court.id, name: court.name, slotId: s.slotId, price: s.price })
        byBand.set(s.bandStart, entry)
      }
    }
    return [...byBand.values()].sort((a, b) => a.bandStart.localeCompare(b.bandStart))
  }

  /** Free bands on the given club-local day for a court (open-by-default). */
  async slotsForDate(clubId: string, dateKey: string, courtId: string): Promise<SlotOption[]> {
    const court = await this.prisma.court.findFirst({
      where: { id: courtId, clubId },
      select: {
        priceCents: true,
        openTime: true,
        closeTime: true,
        priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
      },
    })
    if (!court) return []

    const { gte, lt } = dayRangeUtc(dateKey)
    // Fetch every slot that overlaps the day (including one crossing in from the
    // previous day), not just those starting inside it, so overlap detection is complete.
    const existing = await this.prisma.slot.findMany({
      where: { clubId, courtId, startsAt: { lt }, endsAt: { gt: gte } },
      select: { id: true, startsAt: true, endsAt: true, priceCents: true, status: true },
    })
    // Occupancy is by interval overlap, not exact start: a BOOKED/BLOCKED slot that is
    // off the band grid (e.g. created at a slightly different instant, or after the court's
    // openTime changed) still hides every band it overlaps. AVAILABLE slots are matched by
    // exact start only, to reuse their materialized id/price for the offered band.
    const occupied = existing.filter(s => s.status !== 'AVAILABLE')
    const availableByStart = new Map(
      existing.filter(s => s.status === 'AVAILABLE').map(s => [s.startsAt.toISOString(), s]),
    )
    const now = new Date()

    const options: SlotOption[] = []
    for (const band of generateBands(court.openTime, court.closeTime)) {
      const { startsAt, endsAt } = bandDateTimes(dateKey, band)
      if (startsAt <= now) continue

      // Half-open overlap: [startsAt, endsAt) — a slot merely touching the edge doesn't block.
      const blocked = occupied.some(s => s.startsAt < endsAt && s.endsAt > startsAt)
      if (blocked) continue

      const found = availableByStart.get(startsAt.toISOString())
      if (found) {
        options.push({
          bandStart: band.start,
          slotId: found.id,
          label: formatTimeRange(found.startsAt, found.endsAt),
          price: found.priceCents,
        })
      } else {
        // Not materialized yet — price comes from the court's exceptions or its default.
        const price = resolveBandPriceCents(court.priceCents, court.priceRules, dateKey, band.start)
        options.push({ bandStart: band.start, label: formatTimeRange(startsAt, endsAt), price })
      }
    }
    return options
  }

  /**
   * Nearest upcoming days (within `horizonDays`) that have free bands. With the
   * open-by-default model this rarely fires (only fully booked/blocked or
   * already-past days), but it keeps the bot from ever dead-ending.
   */
  async nextAvailableDates(
    clubId: string,
    fromDateKey: string,
    options: { horizonDays?: number; limit?: number; excludeDateKey?: string } = {},
  ): Promise<AvailableDate[]> {
    const { horizonDays = 21, limit = 3, excludeDateKey } = options

    const courts = await this.prisma.court.findMany({
      where: { clubId },
      select: { id: true, openTime: true, closeTime: true },
    })
    if (courts.length === 0) return []

    const windowStart = dayRangeUtc(fromDateKey).gte
    const windowEnd = dayRangeUtc(shiftDateKey(fromDateKey, horizonDays)).gte
    const occupied = await this.prisma.slot.findMany({
      where: { clubId, status: { in: ['BOOKED', 'BLOCKED'] }, startsAt: { gte: windowStart, lt: windowEnd } },
      select: { startsAt: true },
    })
    const occupiedByDay = new Map<string, number>()
    for (const s of occupied) {
      const key = toDateKey(s.startsAt)
      occupiedByDay.set(key, (occupiedByDay.get(key) ?? 0) + 1)
    }

    const now = new Date()
    const results: AvailableDate[] = []
    for (let i = 0; i < horizonDays && results.length < limit; i++) {
      const key = shiftDateKey(fromDateKey, i)
      if (key === excludeDateKey) continue

      let totalFutureBands = 0
      for (const court of courts) {
        for (const band of generateBands(court.openTime, court.closeTime)) {
          if (bandDateTimes(key, band).startsAt > now) totalFutureBands++
        }
      }
      const free = totalFutureBands - (occupiedByDay.get(key) ?? 0)
      if (free > 0) results.push({ dateKey: key, count: free })
    }
    return results
  }
}

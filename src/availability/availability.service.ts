import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { BandOption, SlotOption } from '../bot/types'
import { dayRangeUtc, formatTimeRange, shiftDateKey } from './lib/datetime'
import { bandDateTimes, bandsForDate, bandSortMinutes, courtScheduleSelect } from './lib/schedule'
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
        const entry = byBand.get(s.bandStart) ?? {
          bandStart: s.bandStart,
          label: s.label,
          courts: [],
          sortMinutes: s.sortMinutes,
        }
        entry.courts.push({ id: court.id, name: court.name, slotId: s.slotId, price: s.price })
        byBand.set(s.bandStart, entry)
      }
    }
    // Chronological, not lexicographic: a past-midnight band ("00:30") closes the day.
    return [...byBand.values()].sort((a, b) => (a.sortMinutes ?? 0) - (b.sortMinutes ?? 0))
  }

  /** Free bands on the given club-local day for a court (open-by-default). */
  async slotsForDate(clubId: string, dateKey: string, courtId: string): Promise<SlotOption[]> {
    const court = await this.prisma.court.findFirst({
      where: { id: courtId, clubId },
      select: {
        priceCents: true,
        ...courtScheduleSelect,
        priceRules: { select: { dayOfWeek: true, startTime: true, priceCents: true } },
      },
    })
    if (!court) return []

    const bands = bandsForDate(court, dateKey)
    if (bands.length === 0) return []
    const bandTimes = bands.map(band => ({ band, ...bandDateTimes(dateKey, band) }))

    const { gte } = dayRangeUtc(dateKey)
    // The day's grid can end past midnight (a "viernes hasta la 1 AM" schedule), so the
    // window runs from the day's start to the last band's end. Fetch every slot that
    // overlaps it (including one crossing in from the previous day), not just those
    // starting inside it, so overlap detection is complete.
    const lastEnd = new Date(Math.max(...bandTimes.map(b => b.endsAt.getTime())))
    const existing = await this.prisma.slot.findMany({
      where: { clubId, courtId, startsAt: { lt: lastEnd }, endsAt: { gt: gte } },
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
    for (const { band, startsAt, endsAt } of bandTimes) {
      if (startsAt <= now) continue

      // Half-open overlap: [startsAt, endsAt) — a slot merely touching the edge doesn't block.
      const blocked = occupied.some(s => s.startsAt < endsAt && s.endsAt > startsAt)
      if (blocked) continue

      const sortMinutes = bandSortMinutes(band)
      const found = availableByStart.get(startsAt.toISOString())
      if (found) {
        options.push({
          bandStart: band.start,
          slotId: found.id,
          label: formatTimeRange(found.startsAt, found.endsAt),
          price: found.priceCents,
          sortMinutes,
        })
      } else {
        // Not materialized yet — price comes from the court's exceptions or its default.
        const price = resolveBandPriceCents(court.priceCents, court.priceRules, dateKey, band.start)
        options.push({ bandStart: band.start, label: formatTimeRange(startsAt, endsAt), price, sortMinutes })
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
      select: { id: true, ...courtScheduleSelect },
    })
    if (courts.length === 0) return []

    const windowStart = dayRangeUtc(fromDateKey).gte
    // +1 day so bands of the last grid day that start past midnight are covered.
    const windowEnd = dayRangeUtc(shiftDateKey(fromDateKey, horizonDays + 1)).gte
    const occupied = await this.prisma.slot.findMany({
      where: { clubId, status: { in: ['BOOKED', 'BLOCKED'] }, startsAt: { gte: windowStart, lt: windowEnd } },
      select: { courtId: true, startsAt: true },
    })
    const occupiedKeys = new Set(occupied.map(s => `${s.courtId}|${s.startsAt.toISOString()}`))

    const now = new Date()
    const results: AvailableDate[] = []
    for (let i = 0; i < horizonDays && results.length < limit; i++) {
      const key = shiftDateKey(fromDateKey, i)
      if (key === excludeDateKey) continue

      let free = 0
      for (const court of courts) {
        for (const band of bandsForDate(court, key)) {
          const { startsAt } = bandDateTimes(key, band)
          if (startsAt <= now) continue
          if (!occupiedKeys.has(`${court.id}|${startsAt.toISOString()}`)) free++
        }
      }
      if (free > 0) results.push({ dateKey: key, count: free })
    }
    return results
  }
}

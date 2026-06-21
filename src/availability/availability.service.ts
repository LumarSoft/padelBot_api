import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CourtOption, SlotOption } from '../bot/types'
import { dayRangeUtc, formatTimeRange, shiftDateKey, toDateKey } from './lib/datetime'
import { bandDateTimes, generateBands } from './lib/schedule'

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

  /** Courts that have at least one free band on the given club-local day. */
  async courtsForDate(clubId: string, dateKey: string): Promise<CourtOption[]> {
    const courts = await this.prisma.court.findMany({
      where: { clubId },
      select: { id: true, name: true, priceCents: true, openTime: true, closeTime: true },
      orderBy: { name: 'asc' },
    })
    if (courts.length === 0) return []

    const occupied = await this.occupiedStartsByCourt(clubId, dateKey)
    const now = new Date()

    return courts
      .filter(court => {
        const bands = generateBands(court.openTime, court.closeTime)
        const taken = occupied.get(court.id) ?? new Set<string>()
        return bands.some(band => {
          const { startsAt } = bandDateTimes(dateKey, band)
          return startsAt > now && !taken.has(startsAt.toISOString())
        })
      })
      .map(c => ({ id: c.id, name: c.name }))
  }

  /** Free bands on the given club-local day for a court (open-by-default). */
  async slotsForDate(clubId: string, dateKey: string, courtId: string): Promise<SlotOption[]> {
    const court = await this.prisma.court.findFirst({
      where: { id: courtId, clubId },
      select: { priceCents: true, openTime: true, closeTime: true },
    })
    if (!court) return []

    const { gte, lt } = dayRangeUtc(dateKey)
    const existing = await this.prisma.slot.findMany({
      where: { clubId, courtId, startsAt: { gte, lt } },
      select: { id: true, startsAt: true, endsAt: true, priceCents: true, status: true },
    })
    const byStart = new Map(existing.map(s => [s.startsAt.toISOString(), s]))
    const now = new Date()

    const options: SlotOption[] = []
    for (const band of generateBands(court.openTime, court.closeTime)) {
      const { startsAt, endsAt } = bandDateTimes(dateKey, band)
      if (startsAt <= now) continue

      const found = byStart.get(startsAt.toISOString())
      if (found) {
        if (found.status !== 'AVAILABLE') continue
        options.push({
          bandStart: band.start,
          slotId: found.id,
          label: formatTimeRange(found.startsAt, found.endsAt),
          price: found.priceCents,
        })
      } else {
        options.push({ bandStart: band.start, label: formatTimeRange(startsAt, endsAt), price: court.priceCents })
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

  /** Map of courtId → set of ISO start instants that are BOOKED or BLOCKED that day. */
  private async occupiedStartsByCourt(clubId: string, dateKey: string): Promise<Map<string, Set<string>>> {
    const { gte, lt } = dayRangeUtc(dateKey)
    const rows = await this.prisma.slot.findMany({
      where: { clubId, status: { in: ['BOOKED', 'BLOCKED'] }, startsAt: { gte, lt } },
      select: { courtId: true, startsAt: true },
    })
    const map = new Map<string, Set<string>>()
    for (const r of rows) {
      const set = map.get(r.courtId) ?? new Set<string>()
      set.add(r.startsAt.toISOString())
      map.set(r.courtId, set)
    }
    return map
  }
}

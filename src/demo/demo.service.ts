import { Injectable, Logger } from '@nestjs/common'
import { Cron, Interval } from '@nestjs/schedule'
import { schedulerEnabled } from '../common/scheduling'
import { PrismaService } from '../prisma/prisma.service'
import { CLUB_TIMEZONE, shiftDateKey, todayKey, wallTimeToUtc } from '../availability/lib/datetime'
import { SALES_DEMO_SLUG, seedSalesDemo } from './sales-demo.seed'
import { tickSalesDemo } from './sales-demo.live'

/**
 * Keeps the sales demo club ("Distrito Pádel") ready for a visit at any time, with nobody
 * refreshing it by hand: a full rebuild every night for the new day, and the live simulator
 * every few minutes during the day.
 *
 * Opt-in by data, not config: it does nothing unless a club with SALES_DEMO_SLUG exists (it
 * never creates it — `npm run demo:seed` does). DEMO_AUTOPILOT=false turns it off.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name)

  constructor(private readonly prisma: PrismaService) {}

  private async enabled(): Promise<boolean> {
    if (!schedulerEnabled() || process.env.DEMO_AUTOPILOT === 'false') return false
    const club = await this.prisma.club.findUnique({ where: { slug: SALES_DEMO_SLUG }, select: { id: true } })
    return !!club
  }

  /** 05:00 club time: rebuild for the new day, with last night's chats stamped at ~23 h. */
  @Cron('0 5 * * *', { timeZone: CLUB_TIMEZONE })
  async rebuildNightly(): Promise<void> {
    try {
      if (!(await this.enabled())) return
      const storyAnchor = wallTimeToUtc(shiftDateKey(todayKey(), -1), '23:05')
      const summary = await seedSalesDemo(this.prisma, { storyAnchor })
      this.logger.log(`Sales demo rebuilt: ${summary.bookings.total} bookings, ${summary.conversations} chats`)
    } catch (err) {
      this.logger.error('Sales demo nightly rebuild failed', err)
    }
  }

  /** Every 5 minutes: confirm the señas that "arrived" and let a new player book when it's time. */
  @Interval(5 * 60_000)
  async keepAlive(): Promise<void> {
    try {
      if (!(await this.enabled())) return
      const tick = await tickSalesDemo(this.prisma)
      if (tick.confirmed || tick.created) {
        this.logger.log(`Sales demo: ${tick.confirmed} seña(s) confirmed${tick.created ? ', 1 new booking' : ''}`)
      }
    } catch (err) {
      this.logger.error('Sales demo tick failed', err)
    }
  }
}

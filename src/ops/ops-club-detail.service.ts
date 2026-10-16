import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { todayKey, toDateKey, wallTimeToUtc } from '../availability/lib/datetime'
import { monthKeyOf } from '../plans/lib/ai-credits'
import { campaignLabel } from '../onboarding/lib/signup-alert'
import { OpsClubRow, OpsClubsService } from './ops-clubs.service'
import { OpsProfitabilityService } from './ops-profitability.service'
import { lastMonths } from './ops-month-states.service'

/** How many months the ficha looks back, the current one included. */
const MONTHS = 6

/** One month of a club: what it used, how it booked, and what it left us. */
export interface ClubMonth {
  month: string
  credits: { used: number; included: number | null }
  bookings: { bot: number; panel: number }
  /** What its plan leaves us that month (net of IVA as inscripto), and what serving it cost. */
  revenueCents: number
  costCents: number
  marginCents: number
  marginPercent: number | null
}

/** The ops console's "ficha" of a club: its row, our notes, where it came from, month by month. */
export interface OpsClubDetail {
  club: OpsClubRow
  opsNotes: string | null
  /** The signup it was provisioned from, if any. */
  lead: {
    id: string
    createdAt: Date
    contactedAt: Date | null
    howFound: string | null
    campaign: string | null
    ownerName: string
    phone: string
    email: string
  } | null
  /** Oldest first, the current month last. */
  months: ClubMonth[]
}

@Injectable()
export class OpsClubDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubs: OpsClubsService,
    private readonly profitability: OpsProfitabilityService,
  ) {}

  async detail(clubId: string): Promise<OpsClubDetail> {
    const club = (await this.clubs.list()).find(row => row.id === clubId)
    if (!club) throw new NotFoundException('Club no encontrado')

    const months = lastMonths(monthKeyOf(todayKey()), MONTHS)
    const [notes, lead, bookings, reports] = await Promise.all([
      this.prisma.club.findUnique({ where: { id: clubId }, select: { opsNotes: true } }),
      this.prisma.clubSignupRequest.findFirst({
        where: { convertedClubId: clubId },
        select: {
          id: true,
          createdAt: true,
          contactedAt: true,
          howFound: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
          ownerName: true,
          phone: true,
          email: true,
        },
      }),
      this.prisma.booking.findMany({
        where: { clubId, createdAt: { gte: wallTimeToUtc(`${months[0]}-01`, '00:00') } },
        select: { createdAt: true, bookedByUserId: true },
      }),
      Promise.all(months.map(month => this.profitability.report(month))),
    ])

    const bookingsByMonth = new Map(months.map(month => [month, { bot: 0, panel: 0 }]))
    for (const booking of bookings) {
      const entry = bookingsByMonth.get(monthKeyOf(toDateKey(booking.createdAt)))
      if (!entry) continue
      // No staff user on the booking = the bot (a player) made it.
      if (booking.bookedByUserId === null) entry.bot++
      else entry.panel++
    }

    return {
      club,
      opsNotes: notes?.opsNotes ?? null,
      lead: lead
        ? {
            id: lead.id,
            createdAt: lead.createdAt,
            contactedAt: lead.contactedAt,
            howFound: lead.howFound,
            campaign: campaignLabel(lead),
            ownerName: lead.ownerName,
            phone: lead.phone,
            email: lead.email,
          }
        : null,
      months: months.map((month, i) => {
        const row = reports[i].clubs.find(r => r.id === clubId)
        return {
          month,
          credits: row?.credits ?? { used: 0, included: null },
          bookings: bookingsByMonth.get(month) ?? { bot: 0, panel: 0 },
          revenueCents: row?.revenue.totalCents ?? 0,
          costCents: row?.cost.totalCents ?? 0,
          marginCents: row?.marginCents ?? 0,
          marginPercent: row?.marginPercent ?? null,
        }
      }),
    }
  }

  /** Our notes on the club; empty clears them. */
  async updateNotes(clubId: string, opsNotes: string | null): Promise<{ opsNotes: string | null }> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { id: true } })
    if (!club) throw new NotFoundException('Club no encontrado')
    const updated = await this.prisma.club.update({
      where: { id: clubId },
      data: { opsNotes: opsNotes?.trim() || null },
      select: { opsNotes: true },
    })
    return updated
  }
}

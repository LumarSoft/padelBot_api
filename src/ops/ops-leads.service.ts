import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ClubSignupRequest } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { OnboardingService } from '../onboarding/onboarding.service'
import { UpdateLeadDto } from './dto/update-lead.dto'
import { ProvisionLeadDto } from './dto/provision-lead.dto'
import { LeadStatus } from './lib/lead-status'
import { isPlanKey } from '../plans/lib/plans'
import { shiftDateKey, todayKey, wallTimeToUtc } from '../availability/lib/datetime'
import { campaignLabel } from '../onboarding/lib/signup-alert'

/** Leads still in play: the ones a call-back date applies to. */
const OPEN_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED']

/** Counts per pipeline stage, so the console can show the funnel without a second call. */
export interface LeadPipeline {
  NEW: number
  CONTACTED: number
  CONVERTED: number
  LOST: number
}

export interface LeadsSummary {
  pipeline: LeadPipeline
  /** Leads that came in over the last 30 days. */
  last30Days: number
  /** Median hours from "lead arrived" to "we contacted them", over leads we did contact. */
  medianResponseHours: number | null
  /** Conversion by acquisition channel — which channel actually produces paying clubs. */
  byChannel: ChannelConversion[]
  /** What prospects say hurts most. Tells us which pitch (and which feature) sells. */
  byPain: { value: string; count: number }[]
  /** Open leads whose call-back date is today or already past: the "para hoy" list. */
  dueToday: number
  /** Conversion by UTM campaign (or source), for the leads that arrived through one. */
  byCampaign: ChannelConversion[]
  /** Why we lose them. */
  byLostReason: { value: string; count: number }[]
}

/** Where prospects drop out of the `/register` signup: visits per screen, in flow order. */
export interface SignupFunnel {
  days: number
  steps: { step: string; index: number; visits: number }[]
  /** Leads that came in over the same days (the signups actually sent). */
  leads: number
}

export interface ChannelConversion {
  /** `howFound` value, or 'UNKNOWN' when they skipped the question. */
  value: string
  leads: number
  converted: number
}

@Injectable()
export class OpsLeadsService {
  private readonly logger = new Logger(OpsLeadsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: OnboardingService,
  ) {}

  /**
   * The pipeline itself. Newest first — a lead going cold is a lead we didn't call today.
   * `due: 'today'` is the call list instead: open leads due today or overdue, oldest date first.
   */
  async list(status?: LeadStatus, due?: 'today'): Promise<ClubSignupRequest[]> {
    if (due === 'today') {
      return this.prisma.clubSignupRequest.findMany({
        where: { status: { in: OPEN_STATUSES }, followUpAt: { lt: endOfToday() } },
        orderBy: { followUpAt: 'asc' },
      })
    }
    return this.prisma.clubSignupRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    })
  }

  async get(id: string): Promise<ClubSignupRequest> {
    const lead = await this.prisma.clubSignupRequest.findUnique({ where: { id } })
    if (!lead) throw new NotFoundException('Lead no encontrado')
    return lead
  }

  /**
   * Moves a lead through the pipeline / edits our notes on it.
   *
   * `contactedAt` is stamped the first time it leaves NEW and never overwritten: it is the
   * start of our response-time metric, and re-touching a lead later shouldn't rewrite when
   * we first got to it. A lost lead has nobody to call back, and a lead taken back from LOST
   * forgets why it was lost.
   */
  async update(id: string, dto: UpdateLeadDto): Promise<ClubSignupRequest> {
    const lead = await this.get(id)

    const leavingNew = dto.status && dto.status !== 'NEW' && !lead.contactedAt
    return this.prisma.clubSignupRequest.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.internalNotes !== undefined ? { internalNotes: dto.internalNotes } : {}),
        ...(leavingNew ? { contactedAt: new Date() } : {}),
        ...(dto.followUpAt !== undefined ? { followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : null } : {}),
        ...(dto.lostReason !== undefined ? { lostReason: dto.lostReason } : {}),
        ...(dto.status === 'LOST' ? { followUpAt: null } : {}),
        ...(dto.status && dto.status !== 'LOST' ? { lostReason: null } : {}),
      },
    })
  }

  /**
   * Deletes a lead for good — only once it's marked LOST, so a lead we still have to call (or a
   * client) can't vanish by a slip. Its answers stop counting in the channel and pain summaries.
   */
  async remove(id: string): Promise<void> {
    const lead = await this.get(id)
    if (lead.status !== 'LOST') {
      throw new ConflictException('Solo se pueden eliminar las solicitudes marcadas como perdidas')
    }
    await this.prisma.clubSignupRequest.delete({ where: { id } })
    this.logger.log(`Lead ${id} (${lead.clubName}) deleted`)
  }

  /**
   * The button that used to be a curl: creates the tenant from the lead's own answers and
   * marks the lead CONVERTED, linked to the club it became.
   *
   * Everything the prospect told us at `/register` (courts, hours, price, deposit policy)
   * is NOT written here — it pre-loads the `/setup` wizard, which we drive sitting with the
   * club. Provisioning stays exactly what it was: an empty club + its OWNER on a trial.
   */
  async provision(id: string, dto: ProvisionLeadDto): Promise<ClubSignupRequest> {
    const lead = await this.get(id)
    if (lead.status === 'CONVERTED') {
      throw new ConflictException('Este lead ya fue convertido en club')
    }

    const { clubId } = await this.onboarding.register({
      clubName: dto.clubName ?? lead.clubName,
      ownerName: dto.ownerName ?? lead.ownerName,
      email: dto.email ?? lead.email,
      password: dto.password,
      plan: dto.plan ?? (lead.plan && isPlanKey(lead.plan) ? lead.plan : undefined),
    })

    this.logger.log(`Lead ${id} (${lead.clubName}) provisioned as club ${clubId}`)

    return this.prisma.clubSignupRequest.update({
      where: { id },
      data: {
        status: 'CONVERTED',
        convertedClubId: clubId,
        contactedAt: lead.contactedAt ?? new Date(),
        followUpAt: null,
      },
    })
  }

  /**
   * The numbers that decide where we spend the next month of sales effort: how fast we
   * answer, which channel converts, and which pain the market keeps naming.
   */
  async summary(): Promise<LeadsSummary> {
    const [grouped, leads, dueToday] = await Promise.all([
      this.prisma.clubSignupRequest.groupBy({ by: ['status'], _count: true }),
      this.prisma.clubSignupRequest.findMany({
        select: {
          status: true,
          howFound: true,
          biggestPain: true,
          createdAt: true,
          contactedAt: true,
          lostReason: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
        },
      }),
      this.prisma.clubSignupRequest.count({
        where: { status: { in: OPEN_STATUSES }, followUpAt: { lt: endOfToday() } },
      }),
    ])

    const pipeline: LeadPipeline = { NEW: 0, CONTACTED: 0, CONVERTED: 0, LOST: 0 }
    for (const row of grouped) {
      if (row.status in pipeline) pipeline[row.status as LeadStatus] = row._count
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const last30Days = leads.filter(l => l.createdAt >= thirtyDaysAgo).length

    // Median, not mean: one lead we forgot for three weeks shouldn't make the number
    // look like we answer in a week when we usually answer in an hour.
    const responseHours = leads
      .filter(l => l.contactedAt)
      .map(l => (l.contactedAt!.getTime() - l.createdAt.getTime()) / 3_600_000)
      .sort((a, b) => a - b)
    const medianResponseHours = responseHours.length
      ? round1(responseHours[Math.floor(responseHours.length / 2)])
      : null

    const byChannel = new Map<string, ChannelConversion>()
    const byPain = new Map<string, number>()
    const byCampaign = new Map<string, ChannelConversion>()
    const byLostReason = new Map<string, number>()
    for (const lead of leads) {
      const campaign = campaignLabel(lead)
      if (campaign) {
        const entry = byCampaign.get(campaign) ?? { value: campaign, leads: 0, converted: 0 }
        entry.leads++
        if (lead.status === 'CONVERTED') entry.converted++
        byCampaign.set(campaign, entry)
      }
      if (lead.status === 'LOST') {
        const reason = lead.lostReason ?? 'UNKNOWN'
        byLostReason.set(reason, (byLostReason.get(reason) ?? 0) + 1)
      }

      const channel = lead.howFound ?? 'UNKNOWN'
      const entry = byChannel.get(channel) ?? { value: channel, leads: 0, converted: 0 }
      entry.leads++
      if (lead.status === 'CONVERTED') entry.converted++
      byChannel.set(channel, entry)

      if (lead.biggestPain) byPain.set(lead.biggestPain, (byPain.get(lead.biggestPain) ?? 0) + 1)
    }

    return {
      pipeline,
      last30Days,
      medianResponseHours,
      byChannel: [...byChannel.values()].sort((a, b) => b.leads - a.leads),
      byPain: [...byPain.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      dueToday,
      byCampaign: [...byCampaign.values()].sort((a, b) => b.leads - a.leads),
      byLostReason: [...byLostReason.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
    }
  }

  /** Visits per `/register` screen over the last `days` (club-local), and the leads sent. */
  async funnel(days = 30): Promise<SignupFunnel> {
    const from = shiftDateKey(todayKey(), -(days - 1))
    const [rows, leads] = await Promise.all([
      this.prisma.signupFunnelDaily.groupBy({
        by: ['step'],
        where: { dateKey: { gte: from } },
        _sum: { visits: true },
        _max: { stepIndex: true },
      }),
      this.prisma.clubSignupRequest.count({ where: { createdAt: { gte: wallTimeToUtc(from, '00:00') } } }),
    ])
    const steps = rows
      .map(row => ({ step: row.step, index: row._max.stepIndex ?? 0, visits: row._sum.visits ?? 0 }))
      .sort((a, b) => a.index - b.index)
    return { days, steps, leads }
  }
}

/** The instant today ends, club-local: a call-back date before it is due. */
function endOfToday(): Date {
  return wallTimeToUtc(shiftDateKey(todayKey(), 1), '00:00')
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

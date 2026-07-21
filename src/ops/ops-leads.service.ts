import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ClubSignupRequest } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { OnboardingService } from '../onboarding/onboarding.service'
import { UpdateLeadDto } from './dto/update-lead.dto'
import { ProvisionLeadDto } from './dto/provision-lead.dto'
import { LeadStatus } from './lib/lead-status'

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

  /** The pipeline itself. Newest first — a lead going cold is a lead we didn't call today. */
  async list(status?: LeadStatus): Promise<ClubSignupRequest[]> {
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
   * we first got to it.
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
      },
    })
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
    })

    this.logger.log(`Lead ${id} (${lead.clubName}) provisioned as club ${clubId}`)

    return this.prisma.clubSignupRequest.update({
      where: { id },
      data: {
        status: 'CONVERTED',
        convertedClubId: clubId,
        contactedAt: lead.contactedAt ?? new Date(),
      },
    })
  }

  /**
   * The numbers that decide where we spend the next month of sales effort: how fast we
   * answer, which channel converts, and which pain the market keeps naming.
   */
  async summary(): Promise<LeadsSummary> {
    const [grouped, leads] = await Promise.all([
      this.prisma.clubSignupRequest.groupBy({ by: ['status'], _count: true }),
      this.prisma.clubSignupRequest.findMany({
        select: {
          status: true,
          howFound: true,
          biggestPain: true,
          createdAt: true,
          contactedAt: true,
        },
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
    for (const lead of leads) {
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
    }
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

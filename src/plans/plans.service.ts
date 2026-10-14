import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { courtLimitMessage, userLimitMessage } from './lib/limits'
import { fitsOneMore, planDefinition, planName } from './lib/plans'

/** Something counted against a plan limit. */
export interface PlanUsage {
  used: number
  /** null = the plan has no limit (or the plan key is unknown). */
  limit: number | null
}

/** What the panel shows about the club's plan: what it includes and how much of it is used. */
export interface ClubPlanOverview {
  plan: {
    key: string
    name: string
    /** False when the stored key is none of the three plans: nothing is restricted then. */
    known: boolean
  }
  courts: PlanUsage
  /** Active users, the owner included. */
  users: PlanUsage
}

/**
 * What a club's plan lets it do. Shared by every module that creates something a plan limits,
 * so the refusal and its wording live in one place.
 */
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(clubId: string): Promise<ClubPlanOverview> {
    const [club, courts, users] = await Promise.all([
      this.clubPlan(clubId),
      this.countCourts(clubId),
      this.countActiveUsers(clubId),
    ])
    const plan = planDefinition(club.plan)
    return {
      plan: { key: club.plan, name: planName(club.plan), known: plan !== null },
      courts: { used: courts, limit: plan?.courts ?? null },
      users: { used: users, limit: plan?.users ?? null },
    }
  }

  /**
   * Refuses a court beyond the plan's limit. A soft limit: courts the club already has are
   * never touched, and two simultaneous creations may both pass — one court over is not worth
   * a lock.
   */
  async assertCanAddCourt(clubId: string): Promise<void> {
    const [club, courts] = await Promise.all([this.clubPlan(clubId), this.countCourts(clubId)])
    const plan = planDefinition(club.plan)
    if (!plan || fitsOneMore(courts, plan.courts)) return
    throw new ForbiddenException(courtLimitMessage(plan, courts))
  }

  /** Refuses one more ACTIVE user (a new one, or reactivating one) beyond the plan's limit. */
  async assertCanAddUser(clubId: string): Promise<void> {
    const [club, users] = await Promise.all([this.clubPlan(clubId), this.countActiveUsers(clubId)])
    const plan = planDefinition(club.plan)
    if (!plan || fitsOneMore(users, plan.users)) return
    throw new ForbiddenException(userLimitMessage(plan, users))
  }

  private async clubPlan(clubId: string): Promise<{ plan: string }> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { plan: true } })
    if (!club) throw new NotFoundException('Club no encontrado')
    return club
  }

  private countCourts(clubId: string): Promise<number> {
    return this.prisma.court.count({ where: { clubId } })
  }

  private countActiveUsers(clubId: string): Promise<number> {
    return this.prisma.user.count({ where: { clubId, isActive: true } })
  }
}

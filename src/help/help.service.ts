import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { DeskAction, Prisma, Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { FaqEntry, parseFaq } from '../clubs/clubs.service'
import { FIRST_DAY_TASK_IDS, FirstDayTaskId, doneFirstDayTasks } from './lib/first-day'
import { isLoggableHelpQuery, normalizeHelpQuery } from './lib/search-query'

/** One house rule: a desk question and the club's own answer (same shape as the bot FAQ). */
export type HouseRule = FaqEntry

export interface FirstDayStatus {
  tasks: { id: FirstDayTaskId; done: boolean }[]
  doneCount: number
  total: number
  /** Every task done — the panel stops showing the card. */
  complete: boolean
  /** When the user closed the card (null = still showing it while incomplete). */
  dismissedAt: Date | null
}

/** One employee's checklist progress, for the OWNER's team table ("4 de 5"). */
export interface TeamMemberFirstDay {
  userId: number
  done: FirstDayTaskId[]
  doneCount: number
  total: number
}

const TOTAL_TASKS = FIRST_DAY_TASK_IDS.length

@Injectable()
export class HelpService {
  private readonly logger = new Logger(HelpService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's "Tu primer día" checklist. Like OnboardingService.getStatus, every task is
   * derived from real data — a booking they made, a desk action they logged — so there is
   * nothing to tick by hand and nothing to fake.
   */
  async getFirstDay(userId: number): Promise<FirstDayStatus> {
    const [user, booking, actions] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { firstDayDismissedAt: true } }),
      this.prisma.booking.findFirst({ where: { bookedByUserId: userId }, select: { id: true } }),
      this.prisma.userFirstAction.findMany({ where: { userId }, select: { action: true } }),
    ])
    if (!user) throw new NotFoundException(`User ${userId} not found`)

    const done = new Set(
      doneFirstDayTasks(
        Boolean(booking),
        actions.map(a => a.action),
      ),
    )
    return {
      tasks: FIRST_DAY_TASK_IDS.map(id => ({ id, done: done.has(id) })),
      doneCount: done.size,
      total: TOTAL_TASKS,
      complete: done.size === TOTAL_TASKS,
      dismissedAt: user.firstDayDismissedAt,
    }
  }

  /** The user closed the card. It can come back from the "?" help; nothing is lost. */
  async dismissFirstDay(userId: number): Promise<{ dismissedAt: Date }> {
    const { firstDayDismissedAt } = await this.prisma.user.update({
      where: { id: userId },
      data: { firstDayDismissedAt: new Date() },
      select: { firstDayDismissedAt: true },
    })
    return { dismissedAt: firstDayDismissedAt ?? new Date() }
  }

  /** Every STAFF member's progress, for the OWNER's team table. Three queries, not one per user. */
  async getTeamFirstDay(clubId: string): Promise<TeamMemberFirstDay[]> {
    const staff = await this.prisma.user.findMany({
      where: { clubId, role: Role.STAFF },
      select: { id: true },
    })
    const userIds = staff.map(u => u.id)
    if (userIds.length === 0) return []

    const [booked, actions] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['bookedByUserId'],
        where: { clubId, bookedByUserId: { in: userIds } },
      }),
      this.prisma.userFirstAction.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, action: true },
      }),
    ])

    const bookedIds = new Set(booked.map(b => b.bookedByUserId))
    return userIds.map(userId => {
      const done = doneFirstDayTasks(
        bookedIds.has(userId),
        actions.filter(a => a.userId === userId).map(a => a.action),
      )
      return { userId, done, doneCount: done.length, total: TOTAL_TASKS }
    })
  }

  /**
   * Records the first time a user did a desk action. Idempotent (one row per user and action)
   * and never throws: it runs after the real action already succeeded, and the checklist must
   * not be able to turn a registered cobro into an error.
   */
  async recordFirstAction(userId: number, action: DeskAction): Promise<void> {
    try {
      await this.prisma.userFirstAction.createMany({ data: [{ userId, action }], skipDuplicates: true })
    } catch (error) {
      this.logger.warn(`Could not record first ${action} for user ${userId}: ${String(error)}`)
    }
  }

  /** The club's house rules, in the owner's order. Read by every panel user. */
  async getHouseRules(clubId: string): Promise<HouseRule[]> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { houseRules: true } })
    if (!club) throw new NotFoundException(`Club ${clubId} not found`)
    return parseFaq(club.houseRules)
  }

  /** Replaces the whole list (edited as a set, like the bot FAQ). Blank rows are dropped. */
  async updateHouseRules(clubId: string, entries: HouseRule[]): Promise<HouseRule[]> {
    const cleaned = entries
      .map(e => ({ question: e.question.trim(), answer: e.answer.trim() }))
      .filter(e => e.question && e.answer)
    await this.prisma.club.update({
      where: { id: clubId },
      data: { houseRules: cleaned.length > 0 ? cleaned : Prisma.DbNull },
    })
    return cleaned
  }

  /**
   * Counts a help search that found nothing, per club and normalized text — the questions the
   * built-in help is missing. Too-short searches and anything that looks like a phone or a DNI
   * are ignored rather than stored.
   */
  async recordSearchMiss(clubId: string, rawQuery: string): Promise<{ recorded: boolean }> {
    const query = normalizeHelpQuery(rawQuery)
    if (!isLoggableHelpQuery(query)) return { recorded: false }

    const bump = () =>
      this.prisma.helpSearchMiss.upsert({
        where: { clubId_query: { clubId, query } },
        create: { clubId, query },
        update: { count: { increment: 1 } },
        select: { id: true },
      })
    try {
      await bump()
    } catch (error) {
      // Two tabs logging the same new miss at once: the loser's create hits the unique key.
      if (!isUniqueConstraintError(error)) throw error
      await bump()
    }
    return { recorded: true }
  }
}

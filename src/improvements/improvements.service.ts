import { Injectable } from '@nestjs/common'
import { ImprovementStatus, ImprovementSuggestionStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { notifyOps } from '../common/ops-alert'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { CreateImprovementSuggestionDto } from './dto/create-improvement-suggestion.dto'

/** A published improvement, as every club sees it. */
export interface PublishedImprovement {
  id: string
  title: string
  body: string
  status: ImprovementStatus
  publishedAt: Date
}

/** One of the club's own suggestions, with what we did with it. */
export interface ClubImprovementSuggestion {
  id: string
  title: string
  body: string
  status: ImprovementSuggestionStatus
  opsReply: string | null
  repliedAt: Date | null
  createdAt: Date
  /** Who proposed it; null once that user is gone. */
  authorName: string | null
  /** The posted improvement that answers it, if any. */
  improvement: { id: string; title: string; status: ImprovementStatus } | null
}

const SUGGESTION_SELECT = {
  id: true,
  title: true,
  body: true,
  status: true,
  opsReply: true,
  repliedAt: true,
  createdAt: true,
  user: { select: { name: true } },
  improvement: { select: { id: true, title: true, status: true, publishedAt: true } },
} as const

/**
 * "Mejoras" for the clubs: the improvements Lumarsoft published (global) and the club's own
 * suggestions to us (always scoped to the caller's clubId). Writing improvements and answering
 * suggestions is the ops console's job (OpsImprovementsService).
 */
@Injectable()
export class ImprovementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Published improvements, newest first. Drafts (publishedAt null) never leave the console. */
  async listPublished(): Promise<PublishedImprovement[]> {
    const rows = await this.prisma.improvement.findMany({
      where: { publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, title: true, body: true, status: true, publishedAt: true },
    })
    return rows.map(row => ({ ...row, publishedAt: row.publishedAt! }))
  }

  /** The club's suggestions (any of its users'), newest first. */
  async listForClub(clubId: string): Promise<ClubImprovementSuggestion[]> {
    const rows = await this.prisma.improvementSuggestion.findMany({
      where: { clubId },
      orderBy: { createdAt: 'desc' },
      select: SUGGESTION_SELECT,
    })
    return rows.map(toClubSuggestion)
  }

  /** Stores the suggestion and pings our ops channel, so it reaches us without opening the console. */
  async create(user: AuthenticatedUser, dto: CreateImprovementSuggestionDto): Promise<ClubImprovementSuggestion> {
    const title = dto.title.trim()
    const body = dto.body.trim()
    const row = await this.prisma.improvementSuggestion.create({
      data: { clubId: user.clubId, userId: parseInt(user.id, 10), title, body },
      select: SUGGESTION_SELECT,
    })
    void notifyOps(`💡 Propuesta de mejora de ${user.clubName} (${user.name}): «${title}»`)
    return toClubSuggestion(row)
  }
}

type SuggestionRow = {
  id: string
  title: string
  body: string
  status: ImprovementSuggestionStatus
  opsReply: string | null
  repliedAt: Date | null
  createdAt: Date
  user: { name: string } | null
  improvement: { id: string; title: string; status: ImprovementStatus; publishedAt: Date | null } | null
}

function toClubSuggestion(row: SuggestionRow): ClubImprovementSuggestion {
  const { user, improvement, ...rest } = row
  return {
    ...rest,
    authorName: user?.name ?? null,
    // A link to a draft would point the club at something it can't see.
    improvement: improvement?.publishedAt
      ? { id: improvement.id, title: improvement.title, status: improvement.status }
      : null,
  }
}

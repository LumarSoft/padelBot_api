import { Injectable, NotFoundException } from '@nestjs/common'
import { ImprovementStatus, ImprovementSuggestionStatus, Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CreateImprovementDto } from './dto/create-improvement.dto'
import { UpdateImprovementDto } from './dto/update-improvement.dto'
import { UpdateImprovementSuggestionDto } from './dto/update-improvement-suggestion.dto'

/** An improvement as the console sees it, drafts included. */
export interface OpsImprovementRow {
  id: string
  title: string
  body: string
  status: ImprovementStatus
  /** Null = draft. */
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** Club suggestions linked to it. */
  suggestionCount: number
}

/** A club's suggestion, across clubs. */
export interface OpsImprovementSuggestionRow {
  id: string
  title: string
  body: string
  status: ImprovementSuggestionStatus
  opsReply: string | null
  repliedAt: Date | null
  createdAt: Date
  clubId: string
  clubName: string
  authorName: string | null
  authorEmail: string | null
  improvement: { id: string; title: string } | null
}

const IMPROVEMENT_SELECT = {
  id: true,
  title: true,
  body: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { suggestions: true } },
} as const

const SUGGESTION_SELECT = {
  id: true,
  title: true,
  body: true,
  status: true,
  opsReply: true,
  repliedAt: true,
  createdAt: true,
  club: { select: { id: true, name: true } },
  user: { select: { name: true, email: true } },
  improvement: { select: { id: true, title: true } },
} as const

/** Suggestions still waiting on us come first in the inbox, in this order. */
const STATUS_ORDER: ImprovementSuggestionStatus[] = ['NEW', 'UNDER_REVIEW', 'PLANNED', 'DONE', 'DECLINED']
const SUGGESTIONS_LIMIT = 200

/**
 * The ops side of "Mejoras": we write the improvements every club reads, and read and answer
 * the suggestions every club sends (cross-tenant on purpose, like the rest of the console).
 */
@Injectable()
export class OpsImprovementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every improvement, drafts first, then newest published. */
  async listImprovements(): Promise<OpsImprovementRow[]> {
    const rows = await this.prisma.improvement.findMany({
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      select: IMPROVEMENT_SELECT,
    })
    return rows.map(toImprovementRow)
  }

  async createImprovement(dto: CreateImprovementDto): Promise<OpsImprovementRow> {
    const row = await this.prisma.improvement.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        status: dto.status ?? 'RELEASED',
        publishedAt: dto.published ? new Date() : null,
      },
      select: IMPROVEMENT_SELECT,
    })
    return toImprovementRow(row)
  }

  async updateImprovement(id: string, dto: UpdateImprovementDto): Promise<OpsImprovementRow> {
    const current = await this.prisma.improvement.findUnique({ where: { id }, select: { publishedAt: true } })
    if (!current) throw new NotFoundException('Mejora no encontrada')

    const data: Prisma.ImprovementUpdateInput = {}
    if (dto.title !== undefined) data.title = dto.title.trim()
    if (dto.body !== undefined) data.body = dto.body.trim()
    if (dto.status !== undefined) data.status = dto.status
    // Re-publishing keeps the original date: an edit shouldn't bump it to the top of the list.
    if (dto.published === true && !current.publishedAt) data.publishedAt = new Date()
    if (dto.published === false) data.publishedAt = null

    const row = await this.prisma.improvement.update({ where: { id }, data, select: IMPROVEMENT_SELECT })
    return toImprovementRow(row)
  }

  /** Linked suggestions keep their status and reply; only the link goes (onDelete: SetNull). */
  async deleteImprovement(id: string): Promise<void> {
    const { count } = await this.prisma.improvement.deleteMany({ where: { id } })
    if (count === 0) throw new NotFoundException('Mejora no encontrada')
  }

  /** The inbox: suggestions waiting on us first, newest first within each status. */
  async listSuggestions(status?: ImprovementSuggestionStatus): Promise<OpsImprovementSuggestionRow[]> {
    const rows = await this.prisma.improvementSuggestion.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: SUGGESTIONS_LIMIT,
      select: SUGGESTION_SELECT,
    })
    return rows.map(toSuggestionRow).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
  }

  async updateSuggestion(id: string, dto: UpdateImprovementSuggestionDto): Promise<OpsImprovementSuggestionRow> {
    const current = await this.prisma.improvementSuggestion.findUnique({ where: { id }, select: { status: true } })
    if (!current) throw new NotFoundException('Propuesta no encontrada')

    if (dto.improvementId) {
      const exists = await this.prisma.improvement.count({ where: { id: dto.improvementId } })
      if (!exists) throw new NotFoundException('Mejora no encontrada')
    }

    const data: Prisma.ImprovementSuggestionUncheckedUpdateInput = {}
    if (dto.status !== undefined) data.status = dto.status
    if (dto.improvementId !== undefined) data.improvementId = dto.improvementId
    if (dto.opsReply !== undefined) {
      const reply = dto.opsReply?.trim() || null
      data.opsReply = reply
      data.repliedAt = reply ? new Date() : null
      // Answering it means we read it: it shouldn't stay in "Nuevas".
      if (reply && dto.status === undefined && current.status === 'NEW') data.status = 'UNDER_REVIEW'
    }

    const row = await this.prisma.improvementSuggestion.update({ where: { id }, data, select: SUGGESTION_SELECT })
    return toSuggestionRow(row)
  }
}

type ImprovementRecord = Omit<OpsImprovementRow, 'suggestionCount'> & { _count: { suggestions: number } }

function toImprovementRow({ _count, ...rest }: ImprovementRecord): OpsImprovementRow {
  return { ...rest, suggestionCount: _count.suggestions }
}

type SuggestionRecord = Omit<OpsImprovementSuggestionRow, 'clubId' | 'clubName' | 'authorName' | 'authorEmail'> & {
  club: { id: string; name: string }
  user: { name: string; email: string } | null
}

function toSuggestionRow({ club, user, ...rest }: SuggestionRecord): OpsImprovementSuggestionRow {
  return {
    ...rest,
    clubId: club.id,
    clubName: club.name,
    authorName: user?.name ?? null,
    authorEmail: user?.email ?? null,
  }
}

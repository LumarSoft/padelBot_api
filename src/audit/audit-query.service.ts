import { Injectable } from '@nestjs/common'
import type { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { dayRangeUtc } from '../availability/lib/datetime'
import { QueryAuditDto } from './dto/query-audit.dto'

const DEFAULT_PAGE_SIZE = 25
const SESSION_ACTIONS = ['LOGIN', 'LOGOUT', 'LOGIN_FAILED'] as const

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(clubId: string, query: QueryAuditDto) {
    const where = this.buildWhere(clubId, query)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE

    const [total, entries] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return { total, page, pageSize, pages: Math.max(Math.ceil(total / pageSize), 1), entries }
  }

  /** Every event of one element, oldest first: the original state and each transformation. */
  async findTimeline(clubId: string, entity: string, entityId: string) {
    const entries = await this.prisma.auditLog.findMany({
      where: { clubId, entity, entityId },
      orderBy: { createdAt: 'asc' },
    })
    return { entity, entityId, total: entries.length, entries }
  }

  async findSessions(clubId: string, query: QueryAuditDto) {
    return this.findAll(clubId, { ...query, entity: 'Session' })
  }

  private buildWhere(clubId: string, query: QueryAuditDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { clubId }
    if (query.entity) where.entity = query.entity
    if (query.entityId) where.entityId = query.entityId
    if (query.action) where.action = query.action
    if (query.userId) where.userId = query.userId
    if (query.from || query.to) {
      const createdAt: Prisma.DateTimeFilter = {}
      if (query.from) createdAt.gte = dayRangeUtc(query.from).gte
      if (query.to) createdAt.lt = dayRangeUtc(query.to).lt
      where.createdAt = createdAt
    }
    return where
  }
}

export { SESSION_ACTIONS }

import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const DAY_MS = 24 * 60 * 60 * 1000
/** Old misses stop mattering once the help has been edited a few times since. */
const WINDOW_DAYS = 90
const LIMIT = 50

/** A help search some club's staff made without finding an answer. */
export interface HelpSearchMissRow {
  query: string
  count: number
  lastSearchedAt: Date
  clubId: string
  clubName: string
}

/**
 * What the desk staff looked for in the panel's "?" help and didn't find, across clubs: the
 * to-do list for the next round of help answers. Most searched first.
 */
@Injectable()
export class OpsHelpService {
  constructor(private readonly prisma: PrismaService) {}

  async searchMisses(): Promise<HelpSearchMissRow[]> {
    const rows = await this.prisma.helpSearchMiss.findMany({
      where: { updatedAt: { gte: new Date(Date.now() - WINDOW_DAYS * DAY_MS) } },
      orderBy: [{ count: 'desc' }, { updatedAt: 'desc' }],
      take: LIMIT,
      select: { query: true, count: true, updatedAt: true, club: { select: { id: true, name: true } } },
    })
    return rows.map(row => ({
      query: row.query,
      count: row.count,
      lastSearchedAt: row.updatedAt,
      clubId: row.club.id,
      clubName: row.club.name,
    }))
  }
}

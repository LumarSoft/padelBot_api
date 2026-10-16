import { ImprovementsService } from './improvements.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { notifyOps } from '../common/ops-alert'

jest.mock('../common/ops-alert', () => ({ notifyOps: jest.fn().mockResolvedValue(undefined) }))

const user: AuthenticatedUser = {
  id: '7',
  email: 'ana@club.com',
  name: 'Ana',
  clubId: 'club-1',
  clubName: 'Club Uno',
  role: 'staff',
  mustChangePassword: false,
}

const createdAt = new Date('2026-10-15T12:00:00Z')

function suggestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    title: 'Exportar a Excel',
    body: 'Poder bajar las reservas del mes',
    status: 'NEW',
    opsReply: null,
    repliedAt: null,
    createdAt,
    user: { name: 'Ana' },
    improvement: null,
    ...overrides,
  }
}

describe('ImprovementsService', () => {
  beforeEach(() => jest.clearAllMocks())

  it('lists only published improvements, newest first', async () => {
    const publishedAt = new Date('2026-10-14T10:00:00Z')
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'i1', title: 'Torneos', body: '…', status: 'RELEASED', publishedAt }])
    const service = new ImprovementsService({ improvement: { findMany } } as unknown as PrismaService)

    await expect(service.listPublished()).resolves.toEqual([
      { id: 'i1', title: 'Torneos', body: '…', status: 'RELEASED', publishedAt },
    ])
    expect(findMany.mock.calls[0][0].where).toEqual({ publishedAt: { not: null } })
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ publishedAt: 'desc' })
  })

  it("lists the caller's club suggestions only, and hides links to drafts", async () => {
    const findMany = jest.fn().mockResolvedValue([
      suggestionRow({ improvement: { id: 'i1', title: 'Draft', status: 'PLANNED', publishedAt: null } }),
      suggestionRow({
        id: 's2',
        user: null,
        improvement: { id: 'i2', title: 'Excel', status: 'RELEASED', publishedAt: createdAt },
      }),
    ])
    const service = new ImprovementsService({ improvementSuggestion: { findMany } } as unknown as PrismaService)

    const rows = await service.listForClub('club-1')

    expect(findMany.mock.calls[0][0].where).toEqual({ clubId: 'club-1' })
    expect(rows[0].improvement).toBeNull()
    expect(rows[0].authorName).toBe('Ana')
    expect(rows[1].improvement).toEqual({ id: 'i2', title: 'Excel', status: 'RELEASED' })
    expect(rows[1].authorName).toBeNull()
  })

  it("stores a suggestion under the caller's club and user and pings ops", async () => {
    const create = jest.fn().mockResolvedValue(suggestionRow())
    const service = new ImprovementsService({ improvementSuggestion: { create } } as unknown as PrismaService)

    const row = await service.create(user, { title: '  Exportar a Excel ', body: ' Poder bajar las reservas del mes ' })

    expect(create.mock.calls[0][0].data).toEqual({
      clubId: 'club-1',
      userId: 7,
      title: 'Exportar a Excel',
      body: 'Poder bajar las reservas del mes',
    })
    expect(row.status).toBe('NEW')
    expect(notifyOps).toHaveBeenCalledWith(expect.stringContaining('Club Uno'))
  })
})

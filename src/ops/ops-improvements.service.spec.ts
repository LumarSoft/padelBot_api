import { NotFoundException } from '@nestjs/common'
import { OpsImprovementsService } from './ops-improvements.service'
import { PrismaService } from '../prisma/prisma.service'

const now = new Date('2026-10-15T12:00:00Z')

function improvementRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    title: 'Torneos',
    body: '…',
    status: 'RELEASED',
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    _count: { suggestions: 2 },
    ...overrides,
  }
}

function suggestionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    title: 'Excel',
    body: '…',
    status: 'NEW',
    opsReply: null,
    repliedAt: null,
    createdAt: now,
    club: { id: 'c1', name: 'Club Uno' },
    user: { name: 'Ana', email: 'ana@club.com' },
    improvement: null,
    ...overrides,
  }
}

describe('OpsImprovementsService', () => {
  it('creates a draft by default and publishes when asked', async () => {
    const create = jest.fn().mockResolvedValue(improvementRecord())
    const service = new OpsImprovementsService({ improvement: { create } } as unknown as PrismaService)

    const row = await service.createImprovement({ title: ' Torneos ', body: ' … ' })
    expect(create.mock.calls[0][0].data).toEqual({ title: 'Torneos', body: '…', status: 'RELEASED', publishedAt: null })
    expect(row.suggestionCount).toBe(2)

    await service.createImprovement({ title: 'Torneos', body: '…', status: 'PLANNED', published: true })
    expect(create.mock.calls[1][0].data.status).toBe('PLANNED')
    expect(create.mock.calls[1][0].data.publishedAt).toBeInstanceOf(Date)
  })

  it('keeps the first publish date when re-published, and clears it when unpublished', async () => {
    const update = jest.fn().mockResolvedValue(improvementRecord())
    const findUnique = jest.fn().mockResolvedValue({ publishedAt: now })
    const service = new OpsImprovementsService({ improvement: { findUnique, update } } as unknown as PrismaService)

    await service.updateImprovement('i1', { published: true, title: 'Nuevo' })
    expect(update.mock.calls[0][0].data).toEqual({ title: 'Nuevo' })

    await service.updateImprovement('i1', { published: false })
    expect(update.mock.calls[1][0].data).toEqual({ publishedAt: null })
  })

  it('404s on an unknown improvement', async () => {
    const service = new OpsImprovementsService({
      improvement: {
        findUnique: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService)

    await expect(service.updateImprovement('x', { title: 'Nuevo' })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.deleteImprovement('x')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('lists suggestions across clubs, the ones waiting on us first', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        suggestionRecord({ id: 'done', status: 'DONE' }),
        suggestionRecord({ id: 'new', status: 'NEW' }),
        suggestionRecord({ id: 'review', status: 'UNDER_REVIEW', user: null }),
      ])
    const service = new OpsImprovementsService({ improvementSuggestion: { findMany } } as unknown as PrismaService)

    const rows = await service.listSuggestions()

    expect(rows.map(r => r.id)).toEqual(['new', 'review', 'done'])
    expect(rows[0]).toMatchObject({
      clubId: 'c1',
      clubName: 'Club Uno',
      authorName: 'Ana',
      authorEmail: 'ana@club.com',
    })
    expect(rows[1].authorName).toBeNull()
    expect(findMany.mock.calls[0][0].where).toBeUndefined()
  })

  it('answering a new suggestion stamps the reply and moves it to UNDER_REVIEW', async () => {
    const update = jest.fn().mockResolvedValue(suggestionRecord({ status: 'UNDER_REVIEW' }))
    const service = new OpsImprovementsService({
      improvementSuggestion: { findUnique: jest.fn().mockResolvedValue({ status: 'NEW' }), update },
    } as unknown as PrismaService)

    await service.updateSuggestion('s1', { opsReply: ' Lo estamos viendo ' })

    const data = update.mock.calls[0][0].data
    expect(data.opsReply).toBe('Lo estamos viendo')
    expect(data.repliedAt).toBeInstanceOf(Date)
    expect(data.status).toBe('UNDER_REVIEW')
  })

  it('refuses to link a suggestion to an improvement that does not exist', async () => {
    const service = new OpsImprovementsService({
      improvementSuggestion: { findUnique: jest.fn().mockResolvedValue({ status: 'NEW' }), update: jest.fn() },
      improvement: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService)

    await expect(service.updateSuggestion('s1', { improvementId: 'nope' })).rejects.toBeInstanceOf(NotFoundException)
  })
})

import { OpsHelpService } from './ops-help.service'
import { PrismaService } from '../prisma/prisma.service'

describe('OpsHelpService.searchMisses', () => {
  it('lists recent misses across clubs, most searched first, with the club name', async () => {
    const updatedAt = new Date('2026-10-14T19:05:00Z')
    const findMany = jest
      .fn()
      .mockResolvedValue([{ query: 'cierre de caja', count: 4, updatedAt, club: { id: 'c1', name: 'Club Uno' } }])
    const service = new OpsHelpService({ helpSearchMiss: { findMany } } as unknown as PrismaService)

    await expect(service.searchMisses()).resolves.toEqual([
      { query: 'cierre de caja', count: 4, lastSearchedAt: updatedAt, clubId: 'c1', clubName: 'Club Uno' },
    ])
    const args = findMany.mock.calls[0][0]
    expect(args.orderBy).toEqual([{ count: 'desc' }, { updatedAt: 'desc' }])
    expect(args.take).toBe(50)
    expect(args.where.updatedAt.gte).toBeInstanceOf(Date)
  })
})

import { PrismaService } from '../prisma/prisma.service'
import { CreditsService } from './credits.service'

function setup() {
  const prisma = {
    whatsAppLine: { findUnique: jest.fn().mockResolvedValue({ clubId: 'c1' }) },
    whatsAppMessageDaily: {
      upsert: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { botService: 40, utility: 2 } }),
    },
  }
  return { prisma, service: new CreditsService(prisma as unknown as PrismaService) }
}

/** A credit is a message the bot sends; replies the staff types are only our Meta cost. */
describe('CreditsService.recordSent', () => {
  it('counts a bot reply on the number and day', async () => {
    const { prisma, service } = setup()

    await service.recordSent('phone-1', 'botService')

    expect(prisma.whatsAppMessageDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ clubId: 'c1', phoneNumberId: 'phone-1', botService: 1 }),
        update: { botService: { increment: 1 } },
      }),
    )
  })

  it('counts a reply the staff typed apart from the bot', async () => {
    const { prisma, service } = setup()

    await service.recordSent('phone-1', 'staffService')

    expect(prisma.whatsAppMessageDaily.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { staffService: { increment: 1 } } }),
    )
  })

  it('ignores a number no club owns', async () => {
    const { prisma, service } = setup()
    prisma.whatsAppLine.findUnique.mockResolvedValueOnce(null)

    await service.recordSent('phone-x', 'botService')

    expect(prisma.whatsAppMessageDaily.upsert).not.toHaveBeenCalled()
  })

  it('never throws, even when the database is down', async () => {
    const { prisma, service } = setup()
    prisma.whatsAppMessageDaily.upsert.mockRejectedValueOnce(new Error('db down'))

    await expect(service.recordSent('phone-1', 'botService')).resolves.toBeUndefined()
  })
})

describe('CreditsService.monthUsed', () => {
  it('adds the bot replies and the templates of the month', async () => {
    const { prisma, service } = setup()

    await expect(service.monthUsed('c1', '2026-10-14')).resolves.toBe(42)
    expect(prisma.whatsAppMessageDaily.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clubId: 'c1', dateKey: { gte: '2026-10-01', lte: '2026-10-14' } } }),
    )
  })
})

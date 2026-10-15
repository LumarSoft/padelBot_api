import { notifyOps } from '../common/ops-alert'
import { PrismaService } from '../prisma/prisma.service'
import { AiCreditAlertsService } from './ai-credit-alerts.service'
import { CreditsService } from './credits.service'

jest.mock('../common/ops-alert', () => ({ notifyOps: jest.fn().mockResolvedValue(undefined) }))

const TODAY = '2026-10-14'

interface ClubRow {
  id: string
  name: string
  plan: string
  aiCreditsAlertMonth: string | null
  aiCreditsAlertPercent: number | null
}

function setup(
  usage: { clubId: string; calls: number }[],
  clubs: ClubRow[],
  opts: { packs?: { remaining: number }[] } = {},
) {
  const prisma = {
    whatsAppMessageDaily: {
      groupBy: jest
        .fn()
        .mockResolvedValue(usage.map(u => ({ clubId: u.clubId, _sum: { botService: u.calls - 10, utility: 10 } }))),
    },
    club: {
      findMany: jest.fn().mockResolvedValue(clubs),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const credits = { activePacks: jest.fn().mockResolvedValue(opts.packs ?? []) }
  return {
    prisma,
    service: new AiCreditAlertsService(prisma as unknown as PrismaService, credits as unknown as CreditsService),
  }
}

const club = (over: Partial<ClubRow> = {}): ClubRow => ({
  id: 'c1',
  name: 'Padel Norte',
  plan: 'saque',
  aiCreditsAlertMonth: null,
  aiCreditsAlertPercent: null,
  ...over,
})

/**
 * Going over the AI credits never touches the bot; ops hears about it instead, once at 80% and
 * once at 100% each month, so the alert means "call this club" and never becomes noise.
 */
describe('AiCreditAlertsService', () => {
  beforeEach(() => jest.mocked(notifyOps).mockClear())

  it('alerts ops once a club passes 80% of its month and remembers it', async () => {
    const { prisma, service } = setup([{ clubId: 'c1', calls: 850 }], [club()])

    await service.alertCrossedThresholds(TODAY)

    expect(notifyOps).toHaveBeenCalledTimes(1)
    expect(jest.mocked(notifyOps).mock.calls[0][0]).toMatch(/Padel Norte.*85%.*850 de 1\.000.*octubre.*Bandeja/)
    expect(prisma.club.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { aiCreditsAlertMonth: '2026-10', aiCreditsAlertPercent: 80 },
    })
  })

  it('does not repeat a threshold already sent this month', async () => {
    const { prisma, service } = setup(
      [{ clubId: 'c1', calls: 950 }],
      [club({ aiCreditsAlertMonth: '2026-10', aiCreditsAlertPercent: 80 })],
    )

    await service.alertCrossedThresholds(TODAY)

    expect(notifyOps).not.toHaveBeenCalled()
    expect(prisma.club.update).not.toHaveBeenCalled()
  })

  it('sends the 100% alert after the 80% one, saying the bot keeps working and what packs are left', async () => {
    const { service } = setup(
      [{ clubId: 'c1', calls: 2_100 }],
      [club({ plan: 'bandeja', aiCreditsAlertMonth: '2026-10', aiCreditsAlertPercent: 80 })],
      { packs: [{ remaining: 400 }] },
    )

    await service.alertCrossedThresholds(TODAY)

    const message = jest.mocked(notifyOps).mock.calls[0][0]
    expect(message).toMatch(/superó sus créditos.*2\.100 de 2\.000/)
    expect(message).toContain('El bot sigue atendiendo igual')
    expect(message).toContain('Le quedan 400 créditos de paquetes')
    expect(message).toContain('Smash')
  })

  it('starts over in a new month', async () => {
    const { service } = setup(
      [{ clubId: 'c1', calls: 820 }],
      [club({ aiCreditsAlertMonth: '2026-09', aiCreditsAlertPercent: 100 })],
    )

    await service.alertCrossedThresholds(TODAY)

    expect(notifyOps).toHaveBeenCalledTimes(1)
  })

  it('stays quiet below 80% and for clubs on an unknown plan', async () => {
    const { service } = setup(
      [
        { clubId: 'c1', calls: 790 },
        { clubId: 'c2', calls: 90_000 },
      ],
      [club(), club({ id: 'c2', plan: 'base' })],
    )

    await service.alertCrossedThresholds(TODAY)

    expect(notifyOps).not.toHaveBeenCalled()
  })

  it('leaves the sales demo out of the query', async () => {
    const { prisma, service } = setup([{ clubId: 'demo', calls: 9_000 }], [])

    await service.alertCrossedThresholds(TODAY)

    expect(prisma.club.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ slug: { not: 'distrito-padel' } }) }),
    )
  })
})

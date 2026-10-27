import { notifyOps } from '../common/ops-alert'
import { PrismaService } from '../prisma/prisma.service'
import { AiCreditAlertsService } from './ai-credit-alerts.service'

jest.mock('../common/ops-alert', () => ({ notifyOps: jest.fn().mockResolvedValue(undefined) }))

const TODAY = '2026-10-14'

interface ClubRow {
  id: string
  name: string
  plan: string
  aiCreditsAlertMonth: string | null
  aiCreditsAlertPercent: number | null
}

function setup(usage: { clubId: string; calls: number }[], clubs: ClubRow[]) {
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
  const notifications = {
    notifyClub: jest.fn().mockResolvedValue(undefined),
    notifyOwners: jest.fn().mockResolvedValue(undefined),
  }
  return {
    prisma,
    notifications,
    service: new AiCreditAlertsService(prisma as unknown as PrismaService, notifications as never),
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
 * Ops and the club hear it when 20%, 10% and 5% of the month's credits are left, and when they
 * run out and the bot pauses — once per threshold and month, so an alert always means something.
 */
describe('AiCreditAlertsService', () => {
  beforeEach(() => jest.mocked(notifyOps).mockClear())

  it('warns ops and the owners once 20% is left, and remembers it', async () => {
    const { prisma, notifications, service } = setup([{ clubId: 'c1', calls: 850 }], [club()])

    await service.alertCrossedThresholds(TODAY)

    expect(notifyOps).toHaveBeenCalledTimes(1)
    expect(jest.mocked(notifyOps).mock.calls[0][0]).toMatch(/Padel Norte.*15%.*850 de 1\.000.*octubre.*Bandeja/)
    expect(notifications.notifyOwners).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ title: 'Te queda el 15% de tus créditos de IA' }),
    )
    expect(notifications.notifyClub).not.toHaveBeenCalled()
    expect(prisma.club.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { aiCreditsAlertMonth: '2026-10', aiCreditsAlertPercent: 80 },
    })
  })

  it('warns again at 10% and at 5% left', async () => {
    for (const [calls, sent, crossed] of [
      [910, 80, 90],
      [960, 90, 95],
    ] as const) {
      const { prisma, service } = setup(
        [{ clubId: 'c1', calls }],
        [club({ aiCreditsAlertMonth: '2026-10', aiCreditsAlertPercent: sent })],
      )

      await service.alertCrossedThresholds(TODAY)

      expect(prisma.club.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { aiCreditsAlertMonth: '2026-10', aiCreditsAlertPercent: crossed } }),
      )
    }
    expect(notifyOps).toHaveBeenCalledTimes(2)
  })

  it('does not repeat a threshold already sent this month', async () => {
    const { prisma, notifications, service } = setup(
      [{ clubId: 'c1', calls: 930 }],
      [club({ aiCreditsAlertMonth: '2026-10', aiCreditsAlertPercent: 90 })],
    )

    await service.alertCrossedThresholds(TODAY)

    expect(notifyOps).not.toHaveBeenCalled()
    expect(notifications.notifyOwners).not.toHaveBeenCalled()
    expect(prisma.club.update).not.toHaveBeenCalled()
  })

  it('announces the pause to ops and to everyone at the club when the credits run out', async () => {
    const { notifications, service } = setup(
      [{ clubId: 'c1', calls: 2_000 }],
      [club({ plan: 'bandeja', aiCreditsAlertMonth: '2026-10', aiCreditsAlertPercent: 95 })],
    )

    await service.alertCrossedThresholds(TODAY)

    const message = jest.mocked(notifyOps).mock.calls[0][0]
    expect(message).toMatch(/se quedó sin créditos.*2\.000 de 2\.000/)
    expect(message).toContain('El bot está pausado hasta que cambie de plan (o hasta el 1° de noviembre)')
    expect(message).toContain('Ofrecele pasar a Smash')
    expect(notifications.notifyClub).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ title: '⏸️ El bot está pausado' }),
    )
  })

  it('says so when no plan has room for what the club uses', async () => {
    const { service } = setup([{ clubId: 'c1', calls: 3_200 }], [club({ plan: 'smash' })])

    await service.alertCrossedThresholds(TODAY)

    expect(jest.mocked(notifyOps).mock.calls[0][0]).toContain('Ningún plan le alcanza')
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

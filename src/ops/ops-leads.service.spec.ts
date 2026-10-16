import { ConflictException } from '@nestjs/common'
import { OnboardingService } from '../onboarding/onboarding.service'
import { PrismaService } from '../prisma/prisma.service'
import { OpsLeadsService } from './ops-leads.service'

function setup(leadPlan: string | null, opts: { status?: string } = {}) {
  const prisma = {
    clubSignupRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'l1',
        clubName: 'Padel Norte',
        ownerName: 'Lucía',
        email: 'lucia@padelnorte.com',
        status: opts.status ?? 'CONTACTED',
        contactedAt: new Date(),
        plan: leadPlan,
      }),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
  }
  const register = jest.fn().mockResolvedValue({ clubId: 'c1', email: 'lucia@padelnorte.com' })
  const service = new OpsLeadsService(prisma as unknown as PrismaService, { register } as unknown as OnboardingService)
  return { service, register, prisma }
}

/** A lead that picked a pricing card starts on that plan unless ops agreed another one. */
describe('OpsLeadsService.provision and the plan', () => {
  it('creates the club on the plan the lead picked', async () => {
    const { service, register } = setup('bandeja')
    await service.provision('l1', { password: 'Temporal123!' })
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ plan: 'bandeja' }))
  })

  it('lets ops override it', async () => {
    const { service, register } = setup('bandeja')
    await service.provision('l1', { password: 'Temporal123!', plan: 'smash' })
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ plan: 'smash' }))
  })

  it('falls back to the default plan without a valid pick', async () => {
    for (const plan of [null, 'pro']) {
      const { service, register } = setup(plan)
      await service.provision('l1', { password: 'Temporal123!' })
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ plan: undefined }))
    }
  })
})

/** A lost lead can be cleaned out of the pipeline; one we still have to call can't vanish by a slip. */
describe('OpsLeadsService.remove', () => {
  it('deletes a lead marked lost', async () => {
    const { service, prisma } = setup(null, { status: 'LOST' })
    await service.remove('l1')
    expect(prisma.clubSignupRequest.delete).toHaveBeenCalledWith({ where: { id: 'l1' } })
  })

  it('refuses any other lead', async () => {
    for (const status of ['NEW', 'CONTACTED', 'CONVERTED']) {
      const { service, prisma } = setup(null, { status })
      await expect(service.remove('l1')).rejects.toThrow(ConflictException)
      expect(prisma.clubSignupRequest.delete).not.toHaveBeenCalled()
    }
  })
})

/** The follow-up: a call-back date, why a lead was lost, and the list of calls due today. */
describe('OpsLeadsService follow-up', () => {
  it('stores the call-back date and clears it', async () => {
    const { service, prisma } = setup(null)
    await service.update('l1', { followUpAt: '2026-10-20T12:00:00.000Z' })
    expect(prisma.clubSignupRequest.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ followUpAt: new Date('2026-10-20T12:00:00.000Z') }) }),
    )

    await service.update('l1', { followUpAt: null })
    expect(prisma.clubSignupRequest.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ followUpAt: null }) }),
    )
  })

  it('records why a lead was lost and drops its call-back date', async () => {
    const { service, prisma } = setup(null)
    await service.update('l1', { status: 'LOST', lostReason: 'PRICE' })
    expect(prisma.clubSignupRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'LOST', lostReason: 'PRICE', followUpAt: null }),
      }),
    )
  })

  it('forgets the reason when a lost lead comes back', async () => {
    const { service, prisma } = setup(null, { status: 'LOST' })
    await service.update('l1', { status: 'CONTACTED' })
    expect(prisma.clubSignupRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONTACTED', lostReason: null }) }),
    )
  })

  it('lists the open leads due today, oldest date first', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const service = new OpsLeadsService({ clubSignupRequest: { findMany } } as never, {} as never)

    await service.list(undefined, 'today')

    const query = findMany.mock.calls[0][0]
    expect(query.where.status).toEqual({ in: ['NEW', 'CONTACTED'] })
    expect(query.where.followUpAt.lt).toBeInstanceOf(Date)
    expect(query.orderBy).toEqual({ followUpAt: 'asc' })
  })
})

describe('OpsLeadsService.funnel', () => {
  it('orders the signup screens by their place in the flow', async () => {
    const prisma = {
      signupFunnelDaily: {
        groupBy: jest.fn().mockResolvedValue([
          { step: 'owner', _sum: { visits: 30 }, _max: { stepIndex: 1 } },
          { step: 'club', _sum: { visits: 40 }, _max: { stepIndex: 0 } },
          { step: 'sent', _sum: { visits: 4 }, _max: { stepIndex: 17 } },
        ]),
      },
      clubSignupRequest: { count: jest.fn().mockResolvedValue(4) },
    }
    const service = new OpsLeadsService(prisma as never, {} as never)

    const funnel = await service.funnel(30)

    expect(funnel.steps.map(s => s.step)).toEqual(['club', 'owner', 'sent'])
    expect(funnel).toMatchObject({ days: 30, leads: 4 })
  })
})

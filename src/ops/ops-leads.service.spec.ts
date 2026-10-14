import { OnboardingService } from '../onboarding/onboarding.service'
import { PrismaService } from '../prisma/prisma.service'
import { OpsLeadsService } from './ops-leads.service'

function setup(leadPlan: string | null) {
  const prisma = {
    clubSignupRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'l1',
        clubName: 'Padel Norte',
        ownerName: 'Lucía',
        email: 'lucia@padelnorte.com',
        status: 'CONTACTED',
        contactedAt: new Date(),
        plan: leadPlan,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const register = jest.fn().mockResolvedValue({ clubId: 'c1', email: 'lucia@padelnorte.com' })
  const service = new OpsLeadsService(prisma as unknown as PrismaService, { register } as unknown as OnboardingService)
  return { service, register }
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

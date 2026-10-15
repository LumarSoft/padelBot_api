import { ForbiddenException } from '@nestjs/common'
import { AuthService } from '../auth/auth.service'
import { CreditsService } from '../plans/credits.service'
import { PlansService } from '../plans/plans.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from './users.service'

/**
 * Deactivating an employee must cut the session they left open right away, not when the
 * session cache expires: `update` has to drop the user from it.
 */
describe('UsersService.update', () => {
  it('forgets the cached session of the user it changes', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ isActive: true }),
        update: jest.fn().mockResolvedValue({ id: 9, isActive: false }),
      },
    } as unknown as PrismaService
    const forgetSession = jest.fn()
    const plans = { assertCanAddUser: jest.fn() }
    const service = new UsersService(
      prisma,
      { forgetSession } as unknown as AuthService,
      plans as unknown as PlansService,
    )

    await service.update('club-1', 1, 9, { isActive: false })

    expect(forgetSession).toHaveBeenCalledWith(9)
    // Deactivating frees a seat: the plan's limit has nothing to say about it.
    expect(plans.assertCanAddUser).not.toHaveBeenCalled()
  })
})

/**
 * The plan's user limit counts ACTIVE users, the owner included. It refuses a new seat — a new
 * user or reactivating one — and never touches the users the club already has.
 */
describe('UsersService and the plan user limit', () => {
  function setup(opts: { plan: string; activeUsers: number; target?: { isActive: boolean } }) {
    const prisma = {
      club: { findUnique: jest.fn().mockResolvedValue({ plan: opts.plan }) },
      user: {
        count: jest.fn().mockResolvedValue(opts.activeUsers),
        findFirst: jest.fn().mockResolvedValue(opts.target ?? null),
        create: jest.fn().mockResolvedValue({ id: 10 }),
        update: jest.fn().mockResolvedValue({ id: 9 }),
      },
    }
    const service = new UsersService(
      prisma as unknown as PrismaService,
      { forgetSession: jest.fn() } as unknown as AuthService,
      new PlansService(prisma as unknown as PrismaService, {} as CreditsService),
    )
    return { prisma, service }
  }

  it('refuses a third active user on Saque', async () => {
    const { prisma, service } = setup({ plan: 'saque', activeUsers: 2 })

    await expect(service.create('club-1', { email: 'a@b.com', name: 'Ana' })).rejects.toThrow(ForbiddenException)
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { clubId: 'club-1', isActive: true } })
  })

  it('creates the user while the plan has room', async () => {
    const { prisma, service } = setup({ plan: 'bandeja', activeUsers: 4 })

    await service.create('club-1', { email: 'a@b.com', name: 'Ana' })

    expect(prisma.user.create).toHaveBeenCalled()
  })

  it('never limits a club on Smash or on an unknown plan', async () => {
    for (const plan of ['smash', 'legacy-typo']) {
      const { prisma, service } = setup({ plan, activeUsers: 40 })
      await service.create('club-1', { email: 'a@b.com', name: 'Ana' })
      expect(prisma.user.create).toHaveBeenCalled()
    }
  })

  it('refuses reactivating someone when the plan is full', async () => {
    const { prisma, service } = setup({ plan: 'saque', activeUsers: 2, target: { isActive: false } })

    await expect(service.update('club-1', 1, 9, { isActive: true })).rejects.toThrow(ForbiddenException)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('lets the owner edit an already active user on a full plan', async () => {
    const { prisma, service } = setup({ plan: 'saque', activeUsers: 3, target: { isActive: true } })

    await service.update('club-1', 1, 9, { isActive: true, name: 'Ana María' })

    expect(prisma.user.update).toHaveBeenCalled()
  })
})

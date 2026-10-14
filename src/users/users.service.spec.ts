import { AuthService } from '../auth/auth.service'
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
        findFirst: jest.fn().mockResolvedValue({ id: 9 }),
        update: jest.fn().mockResolvedValue({ id: 9, isActive: false }),
      },
    } as unknown as PrismaService
    const forgetSession = jest.fn()
    const service = new UsersService(prisma, { forgetSession } as unknown as AuthService)

    await service.update('club-1', 1, 9, { isActive: false })

    expect(forgetSession).toHaveBeenCalledWith(9)
  })
})

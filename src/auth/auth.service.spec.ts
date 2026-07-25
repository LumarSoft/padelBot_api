import { UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuthenticatedUser } from './types/jwt-payload'

/**
 * `getSession` is what keeps a stale-but-signed token from producing an "authenticated"
 * session with no data behind it, so it is tested at the seams: the DB row it reads.
 */
describe('AuthService.getSession', () => {
  const tokenUser: AuthenticatedUser = {
    id: '7',
    email: 'staff@clubdemo.com',
    name: 'Nombre Viejo',
    clubId: 'club-1',
    clubName: 'Club Viejo',
    role: 'staff',
    mustChangePassword: false,
  }

  const dbUser = {
    id: 7,
    email: 'staff@clubdemo.com',
    name: 'Nombre Nuevo',
    role: 'STAFF',
    isActive: true,
    clubId: 'club-1',
    mustChangePassword: false,
    club: { name: 'Club Nuevo' },
  }

  function createService(findUnique: jest.Mock): AuthService {
    const prisma = { user: { findUnique } } as unknown as PrismaService
    return new AuthService(prisma, {} as JwtService)
  }

  it('returns fresh claims from the database, not the token ones', async () => {
    const service = createService(jest.fn().mockResolvedValue(dbUser))

    await expect(service.getSession(tokenUser)).resolves.toEqual({
      id: '7',
      email: 'staff@clubdemo.com',
      name: 'Nombre Nuevo',
      clubId: 'club-1',
      clubName: 'Club Nuevo',
      role: 'staff',
      mustChangePassword: false,
    })
  })

  it('rejects a token whose user no longer exists', async () => {
    const service = createService(jest.fn().mockResolvedValue(null))
    await expect(service.getSession(tokenUser)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a token whose user was deactivated', async () => {
    const service = createService(jest.fn().mockResolvedValue({ ...dbUser, isActive: false }))
    await expect(service.getSession(tokenUser)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a token scoping to a club the user no longer belongs to', async () => {
    const service = createService(jest.fn().mockResolvedValue({ ...dbUser, clubId: 'club-2' }))
    await expect(service.getSession(tokenUser)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a token with a non-numeric subject without hitting the database', async () => {
    const findUnique = jest.fn()
    const service = createService(findUnique)

    await expect(service.getSession({ ...tokenUser, id: 'abc' })).rejects.toThrow(UnauthorizedException)
    expect(findUnique).not.toHaveBeenCalled()
  })
})

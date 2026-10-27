import { UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AuthService, SESSION_CACHE_TTL_MS } from './auth.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuthenticatedUser } from './types/jwt-payload'
import { AuditService } from '../audit/audit.service'

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
    // The audit log is a side effect of authenticating, not part of what these tests assert.
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService
    return new AuthService(prisma, {} as JwtService, audit)
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

/**
 * `validateSession` runs on every authenticated request (JwtStrategy), so it is what cuts the
 * open sessions of a deactivated user. Tested for both halves: it rejects like `getSession`,
 * and its cache never outlives a change made through `forgetSession`.
 */
describe('AuthService.validateSession', () => {
  const tokenUser: AuthenticatedUser = {
    id: '7',
    email: 'staff@clubdemo.com',
    name: 'Staff Demo',
    clubId: 'club-1',
    clubName: 'Club Demo',
    role: 'staff',
    mustChangePassword: false,
  }

  const dbUser = {
    id: 7,
    email: 'staff@clubdemo.com',
    name: 'Staff Demo',
    role: 'STAFF',
    isActive: true,
    clubId: 'club-1',
    mustChangePassword: false,
    club: { name: 'Club Demo' },
  }

  function createService(findUnique: jest.Mock): AuthService {
    const prisma = { user: { findUnique } } as unknown as PrismaService
    return new AuthService(
      prisma,
      {} as JwtService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    )
  }

  afterEach(() => jest.useRealTimers())

  it('rejects the open session of a user who was deactivated', async () => {
    const service = createService(jest.fn().mockResolvedValue({ ...dbUser, isActive: false }))
    await expect(service.validateSession(tokenUser)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a token for a club the user was moved out of', async () => {
    const service = createService(jest.fn().mockResolvedValue({ ...dbUser, clubId: 'club-2' }))
    await expect(service.validateSession(tokenUser)).rejects.toThrow(UnauthorizedException)
  })

  it('returns fresh claims, so a role change applies on the next request', async () => {
    const service = createService(jest.fn().mockResolvedValue({ ...dbUser, role: 'OWNER' }))
    await expect(service.validateSession(tokenUser)).resolves.toMatchObject({ id: '7', role: 'owner' })
  })

  it('reads the user once per TTL instead of once per request', async () => {
    jest.useFakeTimers()
    const findUnique = jest.fn().mockResolvedValue(dbUser)
    const service = createService(findUnique)

    await service.validateSession(tokenUser)
    await service.validateSession(tokenUser)
    expect(findUnique).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(SESSION_CACHE_TTL_MS + 1)
    await service.validateSession(tokenUser)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  it('picks up a deactivation made outside the panel once the cache entry expires', async () => {
    jest.useFakeTimers()
    const findUnique = jest.fn().mockResolvedValue(dbUser)
    const service = createService(findUnique)
    await service.validateSession(tokenUser)

    findUnique.mockResolvedValue({ ...dbUser, isActive: false })
    jest.advanceTimersByTime(SESSION_CACHE_TTL_MS + 1)

    await expect(service.validateSession(tokenUser)).rejects.toThrow(UnauthorizedException)
  })

  it('cuts a cached session at once when the user is forgotten after a change', async () => {
    const findUnique = jest.fn().mockResolvedValue(dbUser)
    const service = createService(findUnique)
    await service.validateSession(tokenUser)

    findUnique.mockResolvedValue({ ...dbUser, isActive: false })
    service.forgetSession(7)

    await expect(service.validateSession(tokenUser)).rejects.toThrow(UnauthorizedException)
  })

  it('does not cache a read that raced a change to the user', async () => {
    let finishRead: (user: typeof dbUser) => void = () => undefined
    const findUnique = jest.fn().mockReturnValueOnce(new Promise(resolve => (finishRead = resolve)))
    const service = createService(findUnique)

    const inFlight = service.validateSession(tokenUser)
    service.forgetSession(7)
    finishRead(dbUser)
    await inFlight

    findUnique.mockResolvedValue({ ...dbUser, isActive: false })
    await expect(service.validateSession(tokenUser)).rejects.toThrow(UnauthorizedException)
  })

  it('does not cache a rejection, so a reactivated user gets back in at once', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ ...dbUser, isActive: false })
      .mockResolvedValue(dbUser)
    const service = createService(findUnique)

    await expect(service.validateSession(tokenUser)).rejects.toThrow(UnauthorizedException)
    await expect(service.validateSession(tokenUser)).resolves.toMatchObject({ id: '7' })
  })

  it('checks the club on a cache hit too, against the token presented', async () => {
    const findUnique = jest.fn().mockResolvedValue(dbUser)
    const service = createService(findUnique)
    await service.validateSession(tokenUser)

    await expect(service.validateSession({ ...tokenUser, clubId: 'club-2' })).rejects.toThrow(UnauthorizedException)
    expect(findUnique).toHaveBeenCalledTimes(1)
  })
})

describe('AuthService.login', () => {
  it('issues a token even if updating lastLoginAt fails', async () => {
    const password = await import('bcrypt').then(({ hash }) => hash('padel1234', 4))
    const user = {
      id: 7,
      email: 'staff@clubdemo.com',
      password,
      name: 'Staff Demo',
      role: 'STAFF',
      isActive: true,
      clubId: 'club-1',
      mustChangePassword: false,
      club: { name: 'Club Demo' },
    }
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockRejectedValue(new Error('database telemetry write failed')),
      },
    } as unknown as PrismaService
    const jwt = { signAsync: jest.fn().mockResolvedValue('test-jwt') } as unknown as JwtService
    const service = new AuthService(prisma, jwt, {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService)

    await expect(service.login({ email: user.email, password: 'padel1234' })).resolves.toMatchObject({
      token: 'test-jwt',
      user: { email: user.email, clubId: user.clubId },
    })
  })
})

import { UnauthorizedException } from '@nestjs/common'
import { AuthService } from '../auth.service'
import { JwtPayload } from '../types/jwt-payload'
import { JwtStrategy } from './jwt.strategy'

/**
 * The strategy is the one place every authenticated request passes through, so it must hand
 * the token to `AuthService.validateSession` (DB-backed) instead of trusting its claims.
 */
describe('JwtStrategy.validate', () => {
  const payload: JwtPayload = {
    sub: '7',
    email: 'staff@clubdemo.com',
    name: 'Staff Demo',
    clubId: 'club-1',
    clubName: 'Club Demo',
    role: 'staff',
    mustChangePassword: false,
  }

  const originalSecret = process.env.JWT_SECRET
  beforeAll(() => (process.env.JWT_SECRET = 'test-secret'))
  afterAll(() => (process.env.JWT_SECRET = originalSecret))

  function createStrategy(validateSession: jest.Mock): JwtStrategy {
    return new JwtStrategy({ validateSession } as unknown as AuthService)
  }

  it('checks the token claims against the database and returns the fresh user', async () => {
    const freshUser = {
      id: '7',
      email: payload.email,
      name: 'Nombre Nuevo',
      clubId: 'club-1',
      clubName: 'Club Demo',
      role: 'owner',
      mustChangePassword: false,
    }
    const validateSession = jest.fn().mockResolvedValue(freshUser)

    await expect(createStrategy(validateSession).validate(payload)).resolves.toBe(freshUser)
    expect(validateSession).toHaveBeenCalledWith({
      id: '7',
      email: payload.email,
      name: payload.name,
      clubId: 'club-1',
      clubName: payload.clubName,
      role: 'staff',
      mustChangePassword: false,
    })
  })

  it('rejects the request when the session is no longer valid', async () => {
    const validateSession = jest.fn().mockRejectedValue(new UnauthorizedException())
    await expect(createStrategy(validateSession).validate(payload)).rejects.toThrow(UnauthorizedException)
  })
})

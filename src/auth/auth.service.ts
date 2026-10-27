import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { hashPassword } from '../common/password'
import { LoginDto } from './dto/login.dto'
import { AuthenticatedUser, AuthRole, JwtPayload } from './types/jwt-payload'
import { AuditService } from '../audit/audit.service'

/** What a client is told when its token no longer maps to an active user of its club. */
const SESSION_INVALID_MESSAGE = 'Tu sesión ya no es válida. Ingresá de nuevo.'

/**
 * How long `validateSession` trusts a session it accepted before reading the user again. It
 * bounds how long a change that bypasses `forgetSession` (a manual DB edit, another API
 * instance) takes to cut a session; deactivating someone from the panel cuts it at once.
 */
export const SESSION_CACHE_TTL_MS = 30_000

export interface LoginResult {
  token: string
  user: AuthenticatedUser
}

/** The user fields a signed session token is built from. */
interface TokenUser {
  id: number
  email: string
  name: string
  clubId: string
  role: Role
  club: { name: string }
  mustChangePassword: boolean
}

/** Maps a user row to the claim shape returned to clients and encoded in the JWT. */
function toAuthenticatedUser(user: TokenUser): AuthenticatedUser {
  return {
    id: String(user.id),
    email: user.email,
    name: user.name,
    clubId: user.clubId,
    clubName: user.club.name,
    role: user.role.toLowerCase() as AuthRole,
    mustChangePassword: user.mustChangePassword,
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  /**
   * Sessions `validateSession` accepted recently, by user id. Bounded by the number of users,
   * so it needs no eviction beyond the TTL.
   */
  private readonly sessionCache = new Map<number, { user: AuthenticatedUser; expiresAt: number }>()

  /** Bumped by `forgetSession`, so a DB read that raced a user change is not cached. */
  private sessionGeneration = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        password: true,
        name: true,
        role: true,
        isActive: true,
        clubId: true,
        mustChangePassword: true,
        club: { select: { name: true } },
      },
    })

    // Same generic error for "no user" and "wrong password" to avoid leaking
    // which emails exist.
    if (!user) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entity: 'Session',
        entityId: dto.email.toLowerCase(),
        summary: `Intento de ingreso con un email inexistente (${dto.email})`,
        actor: { type: 'SYSTEM', label: dto.email },
      })
      throw new UnauthorizedException('Credenciales incorrectas')
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password)
    if (!passwordMatches) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entity: 'Session',
        entityId: String(user.id),
        summary: `Intento de ingreso con contraseña incorrecta (${user.email})`,
        clubId: user.clubId,
        actor: { type: 'SYSTEM', label: user.name },
      })
      throw new UnauthorizedException('Credenciales incorrectas')
    }

    // Checked AFTER the password so a probe can't distinguish "wrong password"
    // from "deactivated account" without knowing the credentials.
    if (!user.isActive) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entity: 'Session',
        entityId: String(user.id),
        summary: `Intento de ingreso de un usuario desactivado (${user.email})`,
        clubId: user.clubId,
        actor: { type: 'SYSTEM', label: user.name },
      })
      throw new UnauthorizedException('Tu usuario fue desactivado. Hablá con el dueño del club.')
    }

    // Retention telemetry must never turn valid credentials into a failed login. Keep it
    // outside the response path; a later successful login can refresh the timestamp.
    void this.prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch(() => this.logger.warn('Could not update lastLoginAt after a successful login'))

    await this.audit.record({
      action: 'LOGIN',
      entity: 'Session',
      entityId: String(user.id),
      summary: `${user.name} inició sesión`,
      clubId: user.clubId,
      actor: { type: 'USER', label: this.actorLabel(user.name, user.role), userId: user.id },
    })

    return this.issueToken(user)
  }

  /**
   * Records the end of the session. The JWT is stateless and is NOT invalidated server-side:
   * the token stays valid until it expires, and the client is the one that discards it. What
   * this endpoint gives us is the audit trail the assignment requires — when each session was
   * closed and by whom. Revoking tokens on logout would need a denylist or short-lived tokens
   * with refresh, and that is a deliberate non-goal for now.
   */
  async logout(user: AuthenticatedUser): Promise<void> {
    await this.audit.record({
      action: 'LOGOUT',
      entity: 'Session',
      entityId: user.id,
      summary: `${user.name} cerró sesión`,
      clubId: user.clubId,
    })
  }

  private actorLabel(name: string, role: Role): string {
    return `${name} (${role === 'OWNER' ? 'dueño' : 'personal'})`
  }

  /**
   * Authoritative session check (uncached; every request goes through `validateSession`, which
   * caches it). A JWT is stateless, so its claims outlive the reality they describe: the user
   * can be deactivated or deleted, or moved to another club, and the token keeps verifying
   * until it expires. Trusting the claims is what lets an employee who left keep using the
   * panel, and what makes a client look logged in while every club-scoped endpoint answers
   * `200` with empty data (they filter by the token's `clubId`).
   *
   * So re-read the user from the DB and reject the session when it no longer maps to an active
   * user, or when the token's `clubId` no longer matches theirs (that token would keep scoping
   * requests to the old tenant, so it has to be re-issued). Otherwise return FRESH claims, so
   * a renamed user/club stops showing a stale name and a role change applies at once.
   */
  async getSession(tokenUser: AuthenticatedUser): Promise<AuthenticatedUser> {
    const id = Number.parseInt(tokenUser.id, 10)
    if (!Number.isInteger(id)) {
      throw new UnauthorizedException(SESSION_INVALID_MESSAGE)
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        clubId: true,
        mustChangePassword: true,
        club: { select: { name: true } },
      },
    })

    if (!user || !user.isActive || user.clubId !== tokenUser.clubId) {
      throw new UnauthorizedException(SESSION_INVALID_MESSAGE)
    }

    return toAuthenticatedUser(user)
  }

  /**
   * `getSession` for every authenticated request: `JwtStrategy` runs it after verifying the
   * signature, so deactivating a user (or moving them to another club) cuts the sessions they
   * already have open — the desk PC left logged in — instead of leaving each token valid until
   * it expires (`JWT_EXPIRES_IN`, 7 days by default).
   *
   * An accepted session is cached for SESSION_CACHE_TTL_MS so this doesn't add a query to every
   * request. Rejections are not cached (reactivating someone works at once), and the club is
   * checked on a hit too: the cached user is fresh, the token presented may be an old one.
   */
  async validateSession(tokenUser: AuthenticatedUser): Promise<AuthenticatedUser> {
    const id = Number.parseInt(tokenUser.id, 10)
    const cached = this.sessionCache.get(id)
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.user.clubId !== tokenUser.clubId) {
        throw new UnauthorizedException(SESSION_INVALID_MESSAGE)
      }
      return cached.user
    }

    this.sessionCache.delete(id)
    const generation = this.sessionGeneration
    const user = await this.getSession(tokenUser)
    if (generation === this.sessionGeneration) {
      this.sessionCache.set(id, { user, expiresAt: Date.now() + SESSION_CACHE_TTL_MS })
    }
    return user
  }

  /**
   * Makes the next request of this user re-read them from the DB. Call it after changing
   * anything `validateSession` checks or returns (active flag, role, name), so the change
   * reaches their open sessions now rather than when the cache entry expires.
   */
  forgetSession(userId: number): void {
    this.sessionGeneration++
    this.sessionCache.delete(userId)
  }

  /**
   * First-login password set for a user on a temporary password. Deliberately does NOT
   * require the current password — they just authenticated with it to reach this call, and
   * re-typing the throwaway temp password adds nothing. Guarded to `mustChangePassword`
   * users so it can never be used as a current-password-less change for a normal account.
   *
   * Returns a FRESH token with the flag cleared, so the caller stays logged in on the same
   * session instead of being bounced to /login to pick up the new claim.
   */
  async completeInitialPasswordChange(userId: number, newPassword: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        clubId: true,
        role: true,
        mustChangePassword: true,
        club: { select: { name: true } },
      },
    })
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado')
    }
    if (!user.mustChangePassword) {
      throw new ForbiddenException('Tu contraseña ya fue establecida. Usá "Cambiar contraseña".')
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(newPassword), mustChangePassword: false },
    })

    await this.audit.record({
      action: 'PASSWORD_CHANGED',
      entity: 'User',
      entityId: String(user.id),
      summary: `${user.name} estableció su contraseña definitiva en el primer ingreso`,
      clubId: user.clubId,
      actor: { type: 'USER', label: this.actorLabel(user.name, user.role), userId: user.id },
    })

    return this.issueToken({ ...user, mustChangePassword: false })
  }

  /** Builds the authenticated user + signed JWT from a user row. Single source of the claim shape. */
  private async issueToken(user: TokenUser): Promise<LoginResult> {
    const authUser = toAuthenticatedUser(user)

    const payload: JwtPayload = {
      sub: authUser.id,
      email: authUser.email,
      name: authUser.name,
      clubId: authUser.clubId,
      clubName: authUser.clubName,
      role: authUser.role,
      mustChangePassword: authUser.mustChangePassword,
    }

    const token = await this.jwt.signAsync(payload)
    return { token, user: authUser }
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AuthService } from '../auth.service'
import { AuthenticatedUser, JwtPayload } from '../types/jwt-payload'
import { setAuditActor } from '../../audit/lib/audit-context'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    const secret = process.env.JWT_SECRET
    if (!secret) {
      throw new UnauthorizedException('JWT secret is not configured')
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    })
  }

  /**
   * Runs after the token signature/expiry is verified. Returns `request.user`. A valid
   * signature only proves who the user was when the token was issued, so the claims are
   * checked against the DB: a deactivated user, or one moved to another club, gets a `401`
   * here on their next request. `request.user` carries the fresh claims (role, names).
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.authService.validateSession({
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      clubId: payload.clubId,
      clubName: payload.clubName,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword,
    })
    // Completes the audit context opened by AuditContextMiddleware: from here on, anything
    // this request writes is attributed to this user without threading them as a parameter.
    // It uses the fresh claims, so a renamed user is recorded with their current name.
    setAuditActor({
      userId: parseInt(user.id, 10),
      clubId: user.clubId,
      label: `${user.name} (${user.role === 'owner' ? 'dueño' : 'personal'})`,
    })
    return user
  }
}

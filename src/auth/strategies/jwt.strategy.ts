import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AuthenticatedUser, JwtPayload } from '../types/jwt-payload'
import { setAuditActor } from '../../audit/lib/audit-context'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
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

  /** Runs after the token signature/expiry is verified. Returns `request.user`. */
  validate(payload: JwtPayload): AuthenticatedUser {
    // Completes the audit context opened by AuditContextMiddleware: from here on, anything
    // this request writes is attributed to this user without threading them as a parameter.
    setAuditActor({
      userId: parseInt(payload.sub, 10),
      clubId: payload.clubId,
      label: `${payload.name} (${payload.role === 'owner' ? 'dueño' : 'personal'})`,
    })
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      clubId: payload.clubId,
      clubName: payload.clubName,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword,
    }
  }
}

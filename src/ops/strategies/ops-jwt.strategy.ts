import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AuthenticatedOpsAdmin, OpsJwtPayload } from '../types/ops-jwt'
import { opsJwtSecret } from '../lib/ops-secret'

/**
 * Passport strategy for the ops console, registered under the name 'ops-jwt' so it never
 * collides with the tenant 'jwt' strategy — and keyed on OPS_JWT_SECRET, not JWT_SECRET, so
 * a club's token cannot even be verified here.
 *
 * With no OPS_JWT_SECRET configured the console is disabled (see lib/ops-secret): the key
 * below is a random per-process value, nothing is ever signed with it, and every request
 * fails to verify.
 */
@Injectable()
export class OpsJwtStrategy extends PassportStrategy(Strategy, 'ops-jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: opsJwtSecret(),
    })
  }

  /** Runs after signature/expiry check. Belt and braces on top of the separate secret. */
  validate(payload: OpsJwtPayload): AuthenticatedOpsAdmin {
    if (payload.scope !== 'platform') {
      throw new UnauthorizedException('Token inválido para la consola de operaciones')
    }
    return { id: payload.sub, email: payload.email, name: payload.name }
  }
}

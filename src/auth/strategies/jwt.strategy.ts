import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AuthenticatedUser, JwtPayload } from '../types/jwt-payload'

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

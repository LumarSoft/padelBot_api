import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { hashPassword } from '../common/password'
import { LoginDto } from './dto/login.dto'
import { AuthenticatedUser, AuthRole, JwtPayload } from './types/jwt-payload'

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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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
      throw new UnauthorizedException('Credenciales incorrectas')
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password)
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales incorrectas')
    }

    // Checked AFTER the password so a probe can't distinguish "wrong password"
    // from "deactivated account" without knowing the credentials.
    if (!user.isActive) {
      throw new UnauthorizedException('Tu usuario fue desactivado. Hablá con el dueño del club.')
    }

    // Retention signal for the ops console — a club that stops opening the panel is
    // churning. Not awaited into the response path beyond the write itself.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    return this.issueToken(user)
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

    return this.issueToken({ ...user, mustChangePassword: false })
  }

  /** Builds the authenticated user + signed JWT from a user row. Single source of the claim shape. */
  private async issueToken(user: TokenUser): Promise<LoginResult> {
    const authUser: AuthenticatedUser = {
      id: String(user.id),
      email: user.email,
      name: user.name,
      clubId: user.clubId,
      clubName: user.club.name,
      role: user.role.toLowerCase() as AuthRole,
      mustChangePassword: user.mustChangePassword,
    }

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

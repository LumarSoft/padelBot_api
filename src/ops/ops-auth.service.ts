import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../prisma/prisma.service'
import { OpsLoginDto } from './dto/ops-login.dto'
import { isOpsEnabled } from './lib/ops-secret'
import { AuthenticatedOpsAdmin, OpsJwtPayload } from './types/ops-jwt'

export interface OpsLoginResult {
  token: string
  admin: AuthenticatedOpsAdmin
}

@Injectable()
export class OpsAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: OpsLoginDto): Promise<OpsLoginResult> {
    // No OPS_JWT_SECRET → the console is off. Say so plainly instead of minting a token
    // signed with the ephemeral key, which would "work" until the next restart.
    if (!isOpsEnabled()) {
      throw new ServiceUnavailableException('La consola de operaciones no está configurada')
    }

    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
      select: { id: true, email: true, password: true, name: true, isActive: true },
    })

    // One generic message for every failure, so a probe can't tell "no such admin" from
    // "wrong password" (same reasoning as AuthService).
    if (!admin) {
      throw new UnauthorizedException('Credenciales incorrectas')
    }

    const passwordMatches = await bcrypt.compare(dto.password, admin.password)
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales incorrectas')
    }

    // Checked AFTER the password, so a deactivated admin is indistinguishable from a
    // wrong password to someone who doesn't have the credentials.
    if (!admin.isActive) {
      throw new UnauthorizedException('Tu acceso fue desactivado.')
    }

    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    })

    const authAdmin: AuthenticatedOpsAdmin = {
      id: String(admin.id),
      email: admin.email,
      name: admin.name,
    }

    const payload: OpsJwtPayload = {
      sub: authAdmin.id,
      email: authAdmin.email,
      name: authAdmin.name,
      scope: 'platform',
    }

    return { token: await this.jwt.signAsync(payload), admin: authAdmin }
  }
}

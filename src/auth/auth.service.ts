import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../prisma/prisma.service'
import { LoginDto } from './dto/login.dto'
import { AuthenticatedUser, JwtPayload } from './types/jwt-payload'

export interface LoginResult {
  token: string
  user: AuthenticatedUser
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
        clubId: true,
        club: { select: { name: true } },
      },
    })

    // Same generic error for "no user" and "wrong password" to avoid leaking
    // which emails exist.
    if (!user) {
      throw new UnauthorizedException('Invalid credentials')
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password)
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials')
    }

    const authUser: AuthenticatedUser = {
      id: String(user.id),
      email: user.email,
      name: user.name,
      clubId: user.clubId,
      clubName: user.club.name,
      role: user.role.toLowerCase() as AuthenticatedUser['role'],
    }

    const payload: JwtPayload = {
      sub: authUser.id,
      email: authUser.email,
      name: authUser.name,
      clubId: authUser.clubId,
      clubName: authUser.clubName,
      role: authUser.role,
    }

    const token = await this.jwt.signAsync(payload)

    return { token, user: authUser }
  }
}

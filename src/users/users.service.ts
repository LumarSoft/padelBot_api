import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { ChangePasswordDto } from './dto/change-password.dto'

const BCRYPT_ROUNDS = 10

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
} as const

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(clubId: string) {
    return this.prisma.user.findMany({
      where: { clubId },
      select: userSelect,
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    })
  }

  /**
   * Creates a team member with a generated temporary password. The password is
   * returned ONCE (the owner passes it to the employee out-of-band); the user is
   * flagged to change it on first use. No email delivery involved, so onboarding a
   * STAFF works without any SMTP setup.
   */
  async create(clubId: string, dto: CreateUserDto) {
    const tempPassword = this.generateTempPassword()
    try {
      const user = await this.prisma.user.create({
        data: {
          clubId,
          email: dto.email.toLowerCase().trim(),
          name: dto.name.trim(),
          role: dto.role ?? Role.STAFF,
          password: await bcrypt.hash(tempPassword, BCRYPT_ROUNDS),
          mustChangePassword: true,
        },
        select: userSelect,
      })
      return { user, tempPassword }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe un usuario con ese email')
      }
      throw error
    }
  }

  /** Updates name/role/active. The caller cannot edit themself (avoids self-lockout). */
  async update(clubId: string, callerId: number, id: number, dto: UpdateUserDto) {
    if (id === callerId) {
      throw new BadRequestException('No podés modificar tu propio usuario desde acá')
    }
    await this.assertInClub(clubId, id)
    return this.prisma.user.update({
      where: { id },
      data: { name: dto.name, role: dto.role, isActive: dto.isActive },
      select: userSelect,
    })
  }

  /** Owner resets a team member's password → returns a fresh temporary password. */
  async resetPassword(clubId: string, callerId: number, id: number) {
    if (id === callerId) {
      throw new BadRequestException('Para tu propia contraseña usá "Cambiar contraseña"')
    }
    await this.assertInClub(clubId, id)
    const tempPassword = this.generateTempPassword()
    await this.prisma.user.update({
      where: { id },
      data: { password: await bcrypt.hash(tempPassword, BCRYPT_ROUNDS), mustChangePassword: true },
    })
    return { tempPassword }
  }

  /** Any authenticated user changes their own password (requires the current one). */
  async changePassword(userId: number, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    })
    if (!user) throw new NotFoundException('Usuario no encontrado')

    const matches = await bcrypt.compare(dto.currentPassword, user.password)
    if (!matches) throw new BadRequestException('La contraseña actual no es correcta')

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS), mustChangePassword: false },
    })
  }

  private async assertInClub(clubId: string, id: number): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id, clubId }, select: { id: true } })
    if (!user) throw new NotFoundException('Usuario no encontrado')
  }

  /**
   * URL-safe temporary password (~71 bits of entropy) that satisfies the product's password
   * policy by construction — a random base64url string has no digit ~12% of the time, and
   * handing someone a temp password the rules would reject is a trap.
   */
  private generateTempPassword(): string {
    const letters = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
    const digits = '23456789'
    const pick = (alphabet: string) => alphabet[randomBytes(1)[0] % alphabet.length]
    return `${randomBytes(9).toString('base64url')}${pick(letters)}${pick(digits)}`
  }
}

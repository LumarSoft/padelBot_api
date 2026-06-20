import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateWhatsAppLineDto } from './dto/create-whatsapp-line.dto'

const lineSelect = {
  id: true,
  phoneNumberId: true,
  displayPhone: true,
  isActive: true,
  createdAt: true,
} as const

@Injectable()
export class WhatsAppLinesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(clubId: string) {
    return this.prisma.whatsAppLine.findMany({
      where: { clubId },
      select: lineSelect,
      orderBy: { createdAt: 'asc' },
    })
  }

  async create(clubId: string, dto: CreateWhatsAppLineDto) {
    const existing = await this.prisma.whatsAppLine.findUnique({
      where: { phoneNumberId: dto.phoneNumberId },
    })
    if (existing) {
      throw new ConflictException(`Phone number ID ${dto.phoneNumberId} is already registered`)
    }

    return this.prisma.whatsAppLine.create({
      data: { phoneNumberId: dto.phoneNumberId, displayPhone: dto.displayPhone, clubId },
      select: lineSelect,
    })
  }

  async remove(clubId: string, id: string) {
    const line = await this.prisma.whatsAppLine.findFirst({ where: { id, clubId } })
    if (!line) throw new NotFoundException(`WhatsApp line ${id} not found`)
    await this.prisma.whatsAppLine.delete({ where: { id } })
  }

  /**
   * Resolves the club that owns a given Meta phone_number_id.
   * Called by the bot on every incoming webhook message.
   */
  async resolveClub(phoneNumberId: string): Promise<{ clubId: string }> {
    const line = await this.prisma.whatsAppLine.findUnique({
      where: { phoneNumberId },
      select: { clubId: true, isActive: true },
    })
    if (!line || !line.isActive) {
      throw new NotFoundException(`No active club found for phone number ID ${phoneNumberId}`)
    }
    return { clubId: line.clubId }
  }
}

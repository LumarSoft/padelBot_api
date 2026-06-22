import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UpdateTransferConfigDto } from './dto/update-transfer-config.dto'

export interface TransferConfig {
  transferAlias: string | null
  transferHolder: string | null
}

@Injectable()
export class ClubsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTransferConfig(clubId: string): Promise<TransferConfig> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { transferAlias: true, transferHolder: true },
    })
    if (!club) throw new NotFoundException(`Club ${clubId} not found`)
    return club
  }

  async updateTransferConfig(clubId: string, dto: UpdateTransferConfigDto): Promise<TransferConfig> {
    await this.prisma.club.update({
      where: { id: clubId },
      data: {
        ...(dto.transferAlias !== undefined ? { transferAlias: dto.transferAlias.trim() || null } : {}),
        ...(dto.transferHolder !== undefined ? { transferHolder: dto.transferHolder.trim() || null } : {}),
      },
    })
    return this.getTransferConfig(clubId)
  }
}

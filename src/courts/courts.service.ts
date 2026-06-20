import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCourtDto } from './dto/create-court.dto'
import { UpdateCourtDto } from './dto/update-court.dto'

const courtSelect = {
  id: true,
  name: true,
  priceCents: true,
  createdAt: true,
  updatedAt: true,
} as const

@Injectable()
export class CourtsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(clubId: string) {
    return this.prisma.court.findMany({
      where: { clubId },
      select: courtSelect,
      orderBy: { name: 'asc' },
    })
  }

  async findOne(clubId: string, id: string) {
    const court = await this.prisma.court.findFirst({
      where: { id, clubId },
      select: courtSelect,
    })
    if (!court) {
      throw new NotFoundException(`Court ${id} not found`)
    }
    return court
  }

  create(clubId: string, dto: CreateCourtDto) {
    return this.prisma.court.create({
      data: { name: dto.name, priceCents: dto.priceCents, clubId },
      select: courtSelect,
    })
  }

  async update(clubId: string, id: string, dto: UpdateCourtDto) {
    await this.findOne(clubId, id)
    return this.prisma.court.update({
      where: { id },
      data: { name: dto.name, priceCents: dto.priceCents },
      select: courtSelect,
    })
  }

  async remove(clubId: string, id: string) {
    await this.findOne(clubId, id)
    await this.prisma.court.delete({ where: { id } })
  }
}

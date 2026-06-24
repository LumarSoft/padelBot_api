import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePriceRuleDto } from './dto/create-price-rule.dto'
import { UpdatePriceRuleDto } from './dto/update-price-rule.dto'

const priceRuleSelect = {
  id: true,
  courtId: true,
  dayOfWeek: true,
  startTime: true,
  priceCents: true,
  createdAt: true,
  updatedAt: true,
} as const

@Injectable()
export class PriceRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForCourt(clubId: string, courtId: string) {
    await this.assertCourt(clubId, courtId)
    return this.prisma.courtPriceRule.findMany({
      where: { clubId, courtId },
      select: priceRuleSelect,
      orderBy: [{ startTime: 'asc' }, { dayOfWeek: 'asc' }],
    })
  }

  async create(clubId: string, courtId: string, dto: CreatePriceRuleDto) {
    await this.assertCourt(clubId, courtId)

    const dayOfWeek = dto.dayOfWeek ?? null
    const existing = await this.prisma.courtPriceRule.findFirst({
      where: { courtId, dayOfWeek, startTime: dto.startTime },
      select: { id: true },
    })
    if (existing) {
      throw new ConflictException('Ya existe una excepción de precio para ese horario y día')
    }

    return this.prisma.courtPriceRule.create({
      data: { clubId, courtId, dayOfWeek, startTime: dto.startTime, priceCents: dto.priceCents },
      select: priceRuleSelect,
    })
  }

  async update(clubId: string, id: string, dto: UpdatePriceRuleDto) {
    await this.assertRule(clubId, id)
    return this.prisma.courtPriceRule.update({
      where: { id },
      data: { priceCents: dto.priceCents },
      select: priceRuleSelect,
    })
  }

  async remove(clubId: string, id: string): Promise<void> {
    await this.assertRule(clubId, id)
    await this.prisma.courtPriceRule.delete({ where: { id } })
  }

  /** Ensures the court exists and belongs to the caller's club. */
  private async assertCourt(clubId: string, courtId: string): Promise<void> {
    const court = await this.prisma.court.findFirst({ where: { id: courtId, clubId }, select: { id: true } })
    if (!court) throw new NotFoundException(`Court ${courtId} not found`)
  }

  /** Ensures the rule exists and belongs to the caller's club. */
  private async assertRule(clubId: string, id: string): Promise<void> {
    const rule = await this.prisma.courtPriceRule.findFirst({ where: { id, clubId }, select: { id: true } })
    if (!rule) throw new NotFoundException(`Price rule ${id} not found`)
  }
}

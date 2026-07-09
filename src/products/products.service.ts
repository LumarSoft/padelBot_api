import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'

const productSelect = {
  id: true,
  name: true,
  priceCents: true,
  category: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(clubId: string) {
    return this.prisma.product.findMany({
      where: { clubId },
      select: productSelect,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
  }

  async findOne(clubId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, clubId },
      select: productSelect,
    })
    if (!product) throw new NotFoundException(`Product ${id} not found`)
    return product
  }

  create(clubId: string, dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        clubId,
        name: dto.name,
        priceCents: dto.priceCents,
        category: dto.category ?? 'OTRO',
        isActive: dto.isActive ?? true,
      },
      select: productSelect,
    })
  }

  async update(clubId: string, id: string, dto: UpdateProductDto) {
    await this.findOne(clubId, id)
    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: productSelect,
    })
  }

  async remove(clubId: string, id: string) {
    await this.findOne(clubId, id)
    await this.prisma.product.delete({ where: { id } })
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { StockService } from '../stock/stock.service'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { normalizeBarcode } from './lib/barcode'

const productSelect = {
  id: true,
  name: true,
  priceCents: true,
  category: true,
  isActive: true,
  barcode: true,
  stockQuantity: true,
  lowStockThreshold: true,
  createdAt: true,
  updatedAt: true,
} as const

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

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

  /**
   * The product a scanned barcode belongs to (inactive ones too: the point of sale warns but
   * never refuses what's physically on the counter).
   */
  async findByBarcode(clubId: string, code: string) {
    const barcode = normalizeBarcode(code)
    const product =
      typeof barcode === 'string'
        ? await this.prisma.product.findFirst({ where: { clubId, barcode }, select: productSelect })
        : null
    if (!product) throw new NotFoundException(`No hay ningún producto con el código ${code}`)
    return product
  }

  /** Creates a product; a starting stock opens its ledger with an "Stock inicial" adjustment. */
  async create(clubId: string, dto: CreateProductDto, userId?: number) {
    if (dto.stockQuantity != null) await this.stock.assertCanStartTracking(clubId)
    const barcode = dto.barcode ?? null
    if (barcode) await this.assertBarcodeFree(clubId, barcode)
    const { id } = await this.withBarcodeConflict(clubId, barcode, () =>
      this.prisma.$transaction(async tx => {
        const created = await tx.product.create({
          data: {
            clubId,
            name: dto.name,
            priceCents: dto.priceCents,
            category: dto.category ?? 'OTRO',
            isActive: dto.isActive ?? true,
            barcode,
            lowStockThreshold: dto.lowStockThreshold ?? null,
          },
          select: { id: true },
        })
        if (dto.stockQuantity != null) {
          await this.stock.setQuantity(tx, clubId, created.id, dto.stockQuantity, { note: 'Stock inicial', userId })
        }
        return created
      }),
    )
    return this.findOne(clubId, id)
  }

  /**
   * Updates a product. A new `stockQuantity` is recorded as an adjustment in the ledger (null
   * stops tracking it); a new minimum re-evaluates the low-stock flag. No push either way: the
   * owner is the one looking at this product.
   */
  async update(clubId: string, id: string, dto: UpdateProductDto, userId?: number) {
    const current = await this.findOne(clubId, id)
    if (dto.stockQuantity != null && current.stockQuantity === null) await this.stock.assertCanStartTracking(clubId)
    const barcode = dto.barcode === undefined ? undefined : (dto.barcode ?? null)
    if (barcode) await this.assertBarcodeFree(clubId, barcode, id)
    await this.withBarcodeConflict(clubId, barcode ?? null, () =>
      this.prisma.$transaction(async tx => {
        await tx.product.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
            ...(dto.category !== undefined ? { category: dto.category } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(barcode !== undefined ? { barcode } : {}),
            ...(dto.lowStockThreshold !== undefined ? { lowStockThreshold: dto.lowStockThreshold } : {}),
          },
        })
        if (dto.stockQuantity !== undefined && dto.stockQuantity !== current.stockQuantity) {
          await this.stock.setQuantity(tx, clubId, id, dto.stockQuantity, {
            note: 'Corrección desde Productos',
            userId,
          })
        } else if (dto.lowStockThreshold !== undefined) {
          await this.stock.refreshLowStockFlag(tx, clubId, id)
        }
      }),
    )
    return this.findOne(clubId, id)
  }

  async remove(clubId: string, id: string) {
    await this.findOne(clubId, id)
    try {
      await this.prisma.product.delete({ where: { id } })
    } catch (err) {
      // Sold at least once (a consumo or a counter sale points at it): deleting would break
      // the day's cash history.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('Este producto ya tiene ventas registradas. Desactivalo en lugar de borrarlo.')
      }
      throw err
    }
  }

  /** A barcode belongs to one product per club: says which one already has it. */
  private async assertBarcodeFree(clubId: string, barcode: string, exceptId?: string): Promise<void> {
    const owner = await this.prisma.product.findFirst({
      where: { clubId, barcode, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { name: true },
    })
    if (owner) throw new ConflictException(`El código ${barcode} ya es de «${owner.name}»`)
  }

  /** Same answer when two saves race past `assertBarcodeFree` and the unique index stops one. */
  private async withBarcodeConflict<T>(clubId: string, barcode: string | null, write: () => Promise<T>): Promise<T> {
    try {
      return await write()
    } catch (err) {
      if (barcode && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.assertBarcodeFree(clubId, barcode)
        throw new ConflictException(`El código ${barcode} ya está cargado en otro producto`)
      }
      throw err
    }
  }
}

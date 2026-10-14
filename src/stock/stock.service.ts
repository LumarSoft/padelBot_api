import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PlayerPaymentMethod, Prisma, StockMovementType } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { dayRangeUtc, todayKey } from '../availability/lib/datetime'
import { consumoDeltas, isLowStock, StockLine } from './lib/stock-math'
import { RegisterPurchaseDto } from './dto/register-purchase.dto'
import { RegisterCountDto } from './dto/register-count.dto'
import { CreateCounterSaleDto } from './dto/create-counter-sale.dto'

type Tx = Prisma.TransactionClient

const stockProductSelect = {
  id: true,
  name: true,
  category: true,
  isActive: true,
  stockQuantity: true,
  lowStockThreshold: true,
  lowStockNotifiedAt: true,
} as const

type StockProduct = Prisma.ProductGetPayload<{ select: typeof stockProductSelect }>

const stockViewSelect = {
  id: true,
  name: true,
  category: true,
  stockQuantity: true,
  lowStockThreshold: true,
} as const

export type StockProductView = Prisma.ProductGetPayload<{ select: typeof stockViewSelect }>

const counterSaleSelect = {
  id: true,
  quantity: true,
  unitPriceCents: true,
  method: true,
  createdAt: true,
  product: { select: { id: true, name: true, category: true } },
  user: { select: { id: true, name: true } },
} as const

export type CounterSaleView = Prisma.CounterSaleGetPayload<{ select: typeof counterSaleSelect }>

/** A product that just dropped to its minimum and whose owner hasn't been told yet. */
export interface LowStockAlert {
  productId: string
  name: string
  stockQuantity: number
  lowStockThreshold: number | null
}

interface MovementInput {
  type: StockMovementType
  note?: string | null
  userId?: number | null
  bookingId?: string
  counterSaleId?: string
}

export interface CountResult {
  productId: string
  name: string
  /** What the system expected. Null = the product wasn't tracked until this count. */
  previousQuantity: number | null
  countedQuantity: number
  /** counted − expected: negative = faltante, positive = sobrante. Null when tracking just started. */
  difference: number | null
}

export interface CounterSalesDay {
  dateKey: string
  sales: CounterSaleView[]
  totalCents: number
  byMethod: Record<PlayerPaymentMethod, number>
}

/** Sums repeated lines of the same product and orders them by id, so every transaction locks
 *  product rows in the same order and two concurrent ones can't deadlock. */
function mergeByProduct(items: StockLine[]): [string, number][] {
  const merged = new Map<string, number>()
  for (const item of items) merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity)
  return [...merged].sort(([a], [b]) => a.localeCompare(b))
}

/**
 * The kiosk's "entra / sale / queda": stock per product, its ledger (StockMovement), the
 * "para comprar" list and counter sales outside a turno. Stock is opt-in per product
 * (`stockQuantity` null = not tracked), never blocks a sale, and every change writes a ledger
 * line in the same transaction as the change itself.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Building blocks (run inside the caller's transaction) ──────────────────

  /**
   * Moves a product's stock by `delta` (negative = units out). Untracked products are left
   * alone unless `startTracking`, which starts them from zero — the first delivery of a product
   * nobody counted yet is the natural moment to start.
   */
  async move(
    tx: Tx,
    clubId: string,
    productId: string,
    delta: number,
    movement: MovementInput & { startTracking?: boolean },
  ): Promise<LowStockAlert | null> {
    const product = await this.lockProduct(tx, clubId, productId)
    if (product.stockQuantity === null && !movement.startTracking) return null
    return this.writeStock(tx, clubId, product, (product.stockQuantity ?? 0) + delta, delta, movement)
  }

  /**
   * Sets a product's stock to an absolute quantity — a physical count or a correction — and
   * records the difference as an ADJUSTMENT. `null` stops tracking the product (no ledger line:
   * there's no quantity left to account for).
   */
  async setQuantity(
    tx: Tx,
    clubId: string,
    productId: string,
    quantity: number | null,
    movement: { note: string; userId?: number | null },
  ): Promise<{ product: StockProduct; previousQuantity: number | null; alert: LowStockAlert | null }> {
    const product = await this.lockProduct(tx, clubId, productId)
    const previousQuantity = product.stockQuantity
    if (quantity === null) {
      await tx.product.update({ where: { id: productId }, data: { stockQuantity: null, lowStockNotifiedAt: null } })
      return { product, previousQuantity, alert: null }
    }
    const alert = await this.writeStock(tx, clubId, product, quantity, quantity - (previousQuantity ?? 0), {
      type: 'ADJUSTMENT',
      ...movement,
    })
    return { product, previousQuantity, alert }
  }

  /**
   * Re-evaluates the low-stock flag after the minimum itself changed: cleared when the product
   * is no longer low, set silently when it now is (the owner editing it already knows).
   */
  async refreshLowStockFlag(tx: Tx, clubId: string, productId: string): Promise<void> {
    const product = await this.lockProduct(tx, clubId, productId)
    const low = isLowStock(product)
    if (low === (product.lowStockNotifiedAt !== null)) return
    await tx.product.update({ where: { id: productId }, data: { lowStockNotifiedAt: low ? new Date() : null } })
  }

  /**
   * Moves stock for a change in a turno's consumos, inside the same transaction that rewrites
   * its BookingProduct lines. Only the net change per product moves stock: adding 2 waters
   * takes 2 out, removing one later puts 1 back.
   */
  async applyConsumos(
    tx: Tx,
    input: { clubId: string; bookingId: string; userId?: number | null; before: StockLine[]; after: StockLine[] },
  ): Promise<LowStockAlert[]> {
    const deltas = [...consumoDeltas(input.before, input.after)].sort(([a], [b]) => a.localeCompare(b))
    const alerts: LowStockAlert[] = []
    for (const [productId, delta] of deltas) {
      const alert = await this.move(tx, input.clubId, productId, delta, {
        type: 'SALE',
        note: delta < 0 ? 'Consumo del turno' : 'Consumo quitado del turno',
        userId: input.userId,
        bookingId: input.bookingId,
      })
      if (alert) alerts.push(alert)
    }
    return alerts
  }

  /** Pushes the owner about products that just hit their minimum. Best-effort, after commit. */
  notifyLowStock(clubId: string, alerts: LowStockAlert[]): void {
    if (alerts.length === 0) return
    const describe = (a: LowStockAlert) =>
      a.stockQuantity <= 0
        ? `${a.name}: no queda`
        : `${a.name}: ${a.stockQuantity === 1 ? 'queda 1' : `quedan ${a.stockQuantity}`}`
    void this.notifications.notifyOwners(clubId, {
      title:
        alerts.length === 1 ? `🛒 Hay que comprar ${alerts[0].name}` : `🛒 Hay que reponer ${alerts.length} productos`,
      body: alerts.map(describe).join(' · '),
      data: { screen: 'stock' },
    })
  }

  // ── Endpoints ──────────────────────────────────────────────────────────────

  /** "Entró mercadería": adds a delivery of several products at once. */
  async registerPurchase(clubId: string, userId: number | null, dto: RegisterPurchaseDto): Promise<StockProductView[]> {
    const lines = mergeByProduct(dto.items)
    await this.prisma.$transaction(async tx => {
      for (const [productId, quantity] of lines) {
        // No push here: whoever is restocking is standing in front of the shelf.
        await this.move(tx, clubId, productId, quantity, {
          type: 'PURCHASE',
          note: dto.note ?? null,
          userId,
          startTracking: true,
        })
      }
    })
    return this.prisma.product.findMany({
      where: { clubId, id: { in: lines.map(([productId]) => productId) } },
      select: stockViewSelect,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
  }

  /**
   * "Contar stock": takes the real quantity of each counted product, stores the difference
   * against what the system expected as an ADJUSTMENT (a zero difference is logged too, so the
   * owner sees the count happened) and returns the differences — the faltantes.
   */
  async registerCount(clubId: string, userId: number | null, dto: RegisterCountDto): Promise<CountResult[]> {
    const ids = dto.items.map(i => i.productId)
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Hay un producto repetido en el conteo')
    const items = [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId))

    const { results, alerts } = await this.prisma.$transaction(async tx => {
      const results = new Map<string, CountResult>()
      const alerts: LowStockAlert[] = []
      for (const item of items) {
        const { product, previousQuantity, alert } = await this.setQuantity(
          tx,
          clubId,
          item.productId,
          item.countedQuantity,
          { note: dto.note ? `Conteo · ${dto.note}` : 'Conteo', userId },
        )
        results.set(item.productId, {
          productId: product.id,
          name: product.name,
          previousQuantity,
          countedQuantity: item.countedQuantity,
          difference: previousQuantity === null ? null : item.countedQuantity - previousQuantity,
        })
        if (alert) alerts.push(alert)
      }
      return { results, alerts }
    })

    this.notifyLowStock(clubId, alerts)
    return dto.items.map(item => results.get(item.productId)!)
  }

  /** Active tracked products at or below their minimum — what to buy next. */
  async shoppingList(clubId: string): Promise<StockProductView[]> {
    const products = await this.prisma.product.findMany({
      where: { clubId, isActive: true, stockQuantity: { not: null } },
      select: stockViewSelect,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    return products.filter(isLowStock)
  }

  /** A product's ledger, newest first: what came in, what went out and what was left. */
  async movements(clubId: string, productId: string, limit = 50) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, clubId },
      select: stockViewSelect,
    })
    if (!product) throw new NotFoundException(`Producto ${productId} no encontrado`)

    const movements = await this.prisma.stockMovement.findMany({
      where: { clubId, productId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        type: true,
        quantity: true,
        stockAfter: true,
        note: true,
        createdAt: true,
        counterSaleId: true,
        user: { select: { id: true, name: true } },
        booking: {
          select: {
            id: true,
            playerName: true,
            slot: { select: { startsAt: true, court: { select: { name: true } } } },
          },
        },
      },
    })
    return { product, movements }
  }

  /**
   * "Venta suelta": someone buys a drink without playing. Each product becomes a CounterSale
   * (price snapshot + how it was paid) that the day's cash and kiosk revenue count, and takes
   * the units out of stock when the product is tracked.
   */
  async createCounterSale(
    clubId: string,
    userId: number | null,
    dto: CreateCounterSaleDto,
  ): Promise<CounterSaleView[]> {
    const lines = mergeByProduct(dto.items)
    const products = await this.prisma.product.findMany({
      where: { clubId, id: { in: lines.map(([productId]) => productId) } },
      select: { id: true, priceCents: true },
    })
    const priceById = new Map(products.map(p => [p.id, p.priceCents]))
    const missing = lines.map(([productId]) => productId).filter(id => !priceById.has(id))
    if (missing.length > 0) throw new NotFoundException(`Productos no encontrados: ${missing.join(', ')}`)

    const { sales, alerts } = await this.prisma.$transaction(async tx => {
      const sales: CounterSaleView[] = []
      const alerts: LowStockAlert[] = []
      const createdAt = new Date()
      for (const [productId, quantity] of lines) {
        const sale = await tx.counterSale.create({
          data: {
            clubId,
            productId,
            quantity,
            unitPriceCents: priceById.get(productId)!,
            method: dto.method,
            userId,
            createdAt,
          },
          select: counterSaleSelect,
        })
        const alert = await this.move(tx, clubId, productId, -quantity, {
          type: 'SALE',
          note: 'Venta suelta',
          userId,
          counterSaleId: sale.id,
        })
        sales.push(sale)
        if (alert) alerts.push(alert)
      }
      return { sales, alerts }
    })

    this.notifyLowStock(clubId, alerts)
    return sales
  }

  /** The counter sales of one club-local day (default today), with the totals per method. */
  async listCounterSales(clubId: string, dateKey: string = todayKey()): Promise<CounterSalesDay> {
    const { gte, lt } = dayRangeUtc(dateKey)
    const sales = await this.prisma.counterSale.findMany({
      where: { clubId, createdAt: { gte, lt } },
      select: counterSaleSelect,
      orderBy: { createdAt: 'desc' },
    })
    const byMethod: Record<PlayerPaymentMethod, number> = { CASH: 0, QR: 0, TRANSFER: 0 }
    for (const sale of sales) byMethod[sale.method] += sale.quantity * sale.unitPriceCents
    return { dateKey, sales, totalCents: byMethod.CASH + byMethod.QR + byMethod.TRANSFER, byMethod }
  }

  /** Undoes a counter sale (wrong product, charged twice…) and puts its units back in stock. */
  async removeCounterSale(clubId: string, id: string, userId: number | null): Promise<void> {
    const sale = await this.prisma.counterSale.findFirst({
      where: { id, clubId },
      select: { productId: true, quantity: true },
    })
    if (!sale) throw new NotFoundException(`Venta ${id} no encontrada`)

    await this.prisma.$transaction(async tx => {
      // The conditional delete is the guard: a double tap can't put the units back twice.
      const { count } = await tx.counterSale.deleteMany({ where: { id, clubId } })
      if (count === 0) throw new NotFoundException(`Venta ${id} no encontrada`)
      await this.move(tx, clubId, sale.productId, sale.quantity, { type: 'SALE', note: 'Venta suelta anulada', userId })
    })
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Reads a club's product with its row write-locked until the transaction ends. The no-op
   * increment is what takes the lock, so a concurrent sale or count can't slip in between
   * reading the stock and writing it back.
   */
  private async lockProduct(tx: Tx, clubId: string, productId: string): Promise<StockProduct> {
    const { count } = await tx.product.updateMany({
      where: { id: productId, clubId },
      data: { stockQuantity: { increment: 0 } },
    })
    if (count === 0) throw new NotFoundException(`Producto ${productId} no encontrado`)
    return tx.product.findUniqueOrThrow({ where: { id: productId }, select: stockProductSelect })
  }

  /**
   * Writes a product's new stock and its ledger line, keeping the low-stock flag in step: set
   * when it drops to its minimum — returning an alert only that first time, so the owner is
   * pushed once per crossing — and cleared as soon as it's back above it.
   */
  private async writeStock(
    tx: Tx,
    clubId: string,
    product: StockProduct,
    next: number,
    delta: number,
    movement: MovementInput,
  ): Promise<LowStockAlert | null> {
    const low = isLowStock({ stockQuantity: next, lowStockThreshold: product.lowStockThreshold })
    await tx.product.update({
      where: { id: product.id },
      data: { stockQuantity: next, lowStockNotifiedAt: low ? (product.lowStockNotifiedAt ?? new Date()) : null },
    })
    await tx.stockMovement.create({
      data: {
        clubId,
        productId: product.id,
        type: movement.type,
        quantity: delta,
        stockAfter: next,
        note: movement.note ?? null,
        userId: movement.userId ?? null,
        bookingId: movement.bookingId ?? null,
        counterSaleId: movement.counterSaleId ?? null,
      },
    })
    if (!low || product.lowStockNotifiedAt !== null) return null
    return {
      productId: product.id,
      name: product.name,
      stockQuantity: next,
      lowStockThreshold: product.lowStockThreshold,
    }
  }
}

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { BookingsService } from '../bookings/bookings.service'
import { StockService } from './stock.service'
import { consumoDeltas, isLowStock } from './lib/stock-math'

/**
 * Kiosk stock: the bill and the shelf must never disagree.
 *
 *  - Loading, editing or clearing a turno's consumos moves stock by the NET change, in the
 *    same transaction that rewrites the bill — a failure anywhere leaves both untouched.
 *  - A physical count stores the difference as an ADJUSTMENT and returns it (the faltante).
 *  - The owner is pushed once when a product drops to its minimum, not on every sale.
 *
 * The DB is an in-memory fake whose writes only work inside `$transaction` (and roll back
 * when the callback throws), so a write that escaped the transaction fails the test.
 */

interface FakeProduct {
  id: string
  clubId: string
  name: string
  category: string
  isActive: boolean
  priceCents: number
  stockQuantity: number | null
  lowStockThreshold: number | null
  lowStockNotifiedAt: Date | null
}

interface FakeLine {
  bookingId: string
  productId: string
  quantity: number
}

const CLUB = 'club-1'

function product(id: string, stockQuantity: number | null, lowStockThreshold: number | null = null): FakeProduct {
  return {
    id,
    clubId: CLUB,
    name: id === 'agua' ? 'Agua 500 ml' : id,
    category: 'BEBIDA',
    isActive: true,
    priceCents: 200_000,
    stockQuantity,
    lowStockThreshold,
    lowStockNotifiedAt: null,
  }
}

function pick<T extends object>(row: T, select?: Record<string, unknown>): Partial<T> {
  if (!select) return row
  return Object.fromEntries(Object.keys(select).map(key => [key, row[key as keyof T]])) as Partial<T>
}

/** The slice of Prisma's query args the fake understands. */
interface Where {
  id?: string | { in: string[] }
  clubId?: string
  bookingId?: string
  stockQuantity?: null
}
interface Query {
  where: Where
  select?: Record<string, unknown>
}

const idOf = (where: Where): string => where.id as string

function fakeDb(products: FakeProduct[], lines: FakeLine[] = []) {
  let state = {
    products: new Map(products.map(p => [p.id, { ...p }])),
    lines: [...lines],
    movements: [] as Record<string, unknown>[],
    sales: [] as Record<string, unknown>[],
  }
  let inTx = false
  const write =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      if (!inTx) throw new Error('write outside the transaction')
      return fn(...args)
    }

  const client = {
    product: {
      findMany: jest.fn(async ({ where, select }: Query) =>
        [...state.products.values()]
          .filter(p => p.clubId === where.clubId && (typeof where.id !== 'object' || where.id.in.includes(p.id)))
          .map(p => pick(p, select)),
      ),
      count: jest.fn(
        async ({ where }: Query) =>
          [...state.products.values()].filter(
            p =>
              p.clubId === where.clubId &&
              (typeof where.id !== 'object' || where.id.in.includes(p.id)) &&
              (where.stockQuantity !== null || p.stockQuantity === null),
          ).length,
      ),
      findFirst: jest.fn(async ({ where, select }: Query) => {
        const p = state.products.get(idOf(where))
        return p && p.clubId === where.clubId ? pick(p, select) : null
      }),
      // The no-op increment the service uses as a row lock.
      updateMany: jest.fn(
        write(async ({ where }: Query) => {
          const p = state.products.get(idOf(where))
          return { count: p && p.clubId === where.clubId ? 1 : 0 }
        }),
      ),
      findUniqueOrThrow: jest.fn(async ({ where, select }: Query) => pick(state.products.get(idOf(where))!, select)),
      update: jest.fn(
        write(async ({ where, data }: Query & { data: Partial<FakeProduct> }) => {
          const p = state.products.get(idOf(where))!
          Object.assign(p, data)
          return p
        }),
      ),
    },
    stockMovement: {
      create: jest.fn(
        write(async ({ data }: { data: Record<string, unknown> }) => {
          state.movements.push(data)
          return data
        }),
      ),
    },
    counterSale: {
      create: jest.fn(
        write(async ({ data }: { data: Record<string, unknown> }) => {
          const sale = { id: `cs${state.sales.length + 1}`, ...data }
          state.sales.push(sale)
          return sale
        }),
      ),
    },
    booking: {
      updateMany: jest.fn(write(async ({ where }: Query) => ({ count: where.clubId === CLUB ? 1 : 0 }))),
    },
    bookingProduct: {
      findMany: jest.fn(async ({ where }: Query) =>
        state.lines
          .filter(l => l.bookingId === where.bookingId)
          .map(l => ({ productId: l.productId, quantity: l.quantity })),
      ),
      deleteMany: jest.fn(
        write(async ({ where }: Query) => {
          state.lines = state.lines.filter(l => l.bookingId !== where.bookingId)
        }),
      ),
      createMany: jest.fn(
        write(async ({ data }: { data: FakeLine[] }) => {
          state.lines.push(...data.map(d => ({ bookingId: d.bookingId, productId: d.productId, quantity: d.quantity })))
        }),
      ),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        products: new Map([...state.products].map(([id, p]) => [id, { ...p }])),
        lines: [...state.lines],
        movements: [...state.movements],
        sales: [...state.sales],
      }
      inTx = true
      try {
        return await fn(client)
      } catch (err) {
        state = snapshot
        throw err
      } finally {
        inTx = false
      }
    }),
  }

  return {
    client,
    stockOf: (id: string) => state.products.get(id)!.stockQuantity,
    productRow: (id: string) => state.products.get(id)!,
    lines: () => state.lines,
    movements: () => state.movements,
    sales: () => state.sales,
  }
}

function setup(products: FakeProduct[], lines: FakeLine[] = [], opts: { planHasStock?: boolean } = {}) {
  const db = fakeDb(products, lines)
  const notifications = { notifyOwners: jest.fn().mockResolvedValue(undefined), notifyClub: jest.fn() }
  const plans = {
    assertFeature: jest.fn(async () => {
      if (opts.planHasStock === false)
        throw new ForbiddenException('El control de stock del kiosco viene con el plan Bandeja.')
    }),
  }
  const stock = new StockService(db.client as never, notifications as never, plans as never)
  const bookings = new BookingsService(
    db.client as never,
    {} as never,
    {} as never,
    notifications as never,
    {} as never,
    {} as never,
    stock,
    plans as never,
    { record: jest.fn() } as never, // audit
  )
  jest.spyOn(bookings, 'findOne').mockResolvedValue({ id: 'b1' } as never)
  const setConsumos = (items: { productId: string; quantity: number; players?: number[] }[]) =>
    bookings.setBookingProducts(CLUB, 'b1', { items: items.map(i => ({ players: [1, 2, 3, 4], ...i })) }, 7)
  return { db, notifications, stock, setConsumos }
}

describe('consumoDeltas', () => {
  it('nets each product across lines: more sold is negative, removed is positive', () => {
    const deltas = consumoDeltas(
      [
        { productId: 'agua', quantity: 2 },
        { productId: 'coca', quantity: 1 },
      ],
      [
        { productId: 'agua', quantity: 1 },
        { productId: 'agua', quantity: 3 },
        { productId: 'grip', quantity: 1 },
      ],
    )
    expect(Object.fromEntries(deltas)).toEqual({ agua: -2, coca: 1, grip: -1 })
  })

  it('leaves out products whose total did not change', () => {
    expect(consumoDeltas([{ productId: 'agua', quantity: 2 }], [{ productId: 'agua', quantity: 2 }]).size).toBe(0)
  })
})

describe('isLowStock', () => {
  it('uses the minimum, or zero when none is set; untracked is never low', () => {
    expect(isLowStock({ stockQuantity: 6, lowStockThreshold: 6 })).toBe(true)
    expect(isLowStock({ stockQuantity: 7, lowStockThreshold: 6 })).toBe(false)
    expect(isLowStock({ stockQuantity: 0, lowStockThreshold: null })).toBe(true)
    expect(isLowStock({ stockQuantity: 1, lowStockThreshold: null })).toBe(false)
    expect(isLowStock({ stockQuantity: null, lowStockThreshold: 5 })).toBe(false)
  })
})

describe('BookingsService.setBookingProducts → stock', () => {
  it('takes the sold units out of stock and writes the ledger line, linked to the turno', async () => {
    const { db, setConsumos } = setup([product('agua', 20, 5)])

    await setConsumos([{ productId: 'agua', quantity: 2 }])

    expect(db.stockOf('agua')).toBe(18)
    expect(db.movements()).toEqual([
      expect.objectContaining({
        productId: 'agua',
        type: 'SALE',
        quantity: -2,
        stockAfter: 18,
        bookingId: 'b1',
        userId: 7,
      }),
    ])
    expect(db.lines()).toEqual([{ bookingId: 'b1', productId: 'agua', quantity: 2 }])
  })

  it('moves only the net change when the bill is edited', async () => {
    const { db, setConsumos } = setup(
      [product('agua', 17), product('coca', 10)],
      [
        { bookingId: 'b1', productId: 'agua', quantity: 3 },
        { bookingId: 'b1', productId: 'coca', quantity: 1 },
      ],
    )

    // 3 aguas → 1, the coca stays, a new coca line for J2.
    await setConsumos([
      { productId: 'agua', quantity: 1 },
      { productId: 'coca', quantity: 1 },
      { productId: 'coca', quantity: 1, players: [2] },
    ])

    expect(db.stockOf('agua')).toBe(19)
    expect(db.stockOf('coca')).toBe(9)
    expect(db.movements()).toEqual([
      expect.objectContaining({ productId: 'agua', quantity: 2, stockAfter: 19, note: 'Consumo quitado del turno' }),
      expect.objectContaining({ productId: 'coca', quantity: -1, stockAfter: 9, note: 'Consumo del turno' }),
    ])
  })

  it('puts every unit back when the consumos are cleared', async () => {
    const { db, setConsumos } = setup([product('agua', 4)], [{ bookingId: 'b1', productId: 'agua', quantity: 2 }])

    await setConsumos([])

    expect(db.stockOf('agua')).toBe(6)
    expect(db.lines()).toEqual([])
  })

  it('does not move stock when the bill is re-saved with the same quantities (re-split among players)', async () => {
    const { db, setConsumos } = setup([product('agua', 10)], [{ bookingId: 'b1', productId: 'agua', quantity: 2 }])

    await setConsumos([{ productId: 'agua', quantity: 2, players: [1, 3] }])

    expect(db.stockOf('agua')).toBe(10)
    expect(db.movements()).toEqual([])
  })

  it('never touches a product whose stock is not tracked', async () => {
    const { db, setConsumos } = setup([product('paleta', null)])

    await setConsumos([{ productId: 'paleta', quantity: 1 }])

    expect(db.stockOf('paleta')).toBeNull()
    expect(db.movements()).toEqual([])
  })

  it('sells even with no stock left — the counter goes negative until the next count', async () => {
    const { db, setConsumos } = setup([product('agua', 0)])

    await setConsumos([{ productId: 'agua', quantity: 1 }])

    expect(db.stockOf('agua')).toBe(-1)
  })

  it('rolls back the bill and the stock together when the ledger write fails', async () => {
    const { db, setConsumos } = setup([product('agua', 20)], [{ bookingId: 'b1', productId: 'agua', quantity: 1 }])
    db.client.stockMovement.create.mockRejectedValueOnce(new Error('db down'))

    await expect(setConsumos([{ productId: 'agua', quantity: 3 }])).rejects.toThrow('db down')

    expect(db.stockOf('agua')).toBe(20)
    expect(db.lines()).toEqual([{ bookingId: 'b1', productId: 'agua', quantity: 1 }])
    expect(db.movements()).toEqual([])
  })

  it('pushes the owner once when a product drops to its minimum, not on every later sale', async () => {
    const { db, notifications, setConsumos } = setup([product('agua', 7, 5)])

    await setConsumos([{ productId: 'agua', quantity: 2 }]) // 7 → 5: hits the minimum
    expect(notifications.notifyOwners).toHaveBeenCalledTimes(1)
    expect(notifications.notifyOwners).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({ title: '🛒 Hay que comprar Agua 500 ml', body: 'Agua 500 ml: quedan 5' }),
    )
    expect(db.productRow('agua').lowStockNotifiedAt).toBeInstanceOf(Date)

    await setConsumos([{ productId: 'agua', quantity: 4 }]) // 5 → 3: still low, already told
    expect(notifications.notifyOwners).toHaveBeenCalledTimes(1)
  })

  it('pushes again only after the product was restocked above its minimum', async () => {
    const { db, notifications, stock, setConsumos } = setup([product('agua', 7, 5)])
    await setConsumos([{ productId: 'agua', quantity: 2 }]) // low → push #1

    await stock.registerPurchase(CLUB, 7, { items: [{ productId: 'agua', quantity: 24 }] }) // 29: restocked
    expect(db.productRow('agua').lowStockNotifiedAt).toBeNull()

    await setConsumos([{ productId: 'agua', quantity: 26 }]) // 29 → 5: low again → push #2
    expect(notifications.notifyOwners).toHaveBeenCalledTimes(2)
  })
})

describe('StockService.registerCount', () => {
  it('stores the difference as an ADJUSTMENT and returns the faltante', async () => {
    const { db, stock } = setup([product('agua', 10, 3)])

    const result = await stock.registerCount(CLUB, 7, { items: [{ productId: 'agua', countedQuantity: 7 }] })

    expect(result).toEqual([
      { productId: 'agua', name: 'Agua 500 ml', previousQuantity: 10, countedQuantity: 7, difference: -3 },
    ])
    expect(db.stockOf('agua')).toBe(7)
    expect(db.movements()).toEqual([
      expect.objectContaining({ type: 'ADJUSTMENT', quantity: -3, stockAfter: 7, note: 'Conteo', userId: 7 }),
    ])
  })

  it('logs a count with no difference too, so the owner sees it happened', async () => {
    const { db, stock } = setup([product('coca', 12)])

    const [result] = await stock.registerCount(CLUB, 7, { items: [{ productId: 'coca', countedQuantity: 12 }] })

    expect(result.difference).toBe(0)
    expect(db.movements()).toEqual([expect.objectContaining({ quantity: 0, stockAfter: 12 })])
  })

  it('starts tracking a product that was never counted', async () => {
    const { db, stock } = setup([product('grip', null)])

    const [result] = await stock.registerCount(CLUB, 7, { items: [{ productId: 'grip', countedQuantity: 12 }] })

    expect(result).toEqual(expect.objectContaining({ previousQuantity: null, countedQuantity: 12, difference: null }))
    expect(db.stockOf('grip')).toBe(12)
    expect(db.movements()).toEqual([expect.objectContaining({ quantity: 12, stockAfter: 12 })])
  })

  it('pushes the owner when the count reveals a product at its minimum', async () => {
    const { notifications, stock } = setup([product('agua', 30, 6), product('coca', 30, 6)])

    await stock.registerCount(CLUB, 7, {
      items: [
        { productId: 'agua', countedQuantity: 4 },
        { productId: 'coca', countedQuantity: 25 },
      ],
    })

    expect(notifications.notifyOwners).toHaveBeenCalledTimes(1)
    expect(notifications.notifyOwners).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({ body: 'Agua 500 ml: quedan 4' }),
    )
  })

  it('rejects the same product twice in one count', async () => {
    const { stock } = setup([product('agua', 10)])

    await expect(
      stock.registerCount(CLUB, 7, {
        items: [
          { productId: 'agua', countedQuantity: 3 },
          { productId: 'agua', countedQuantity: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses a product from another club and writes nothing', async () => {
    const { db, stock } = setup([product('agua', 10), { ...product('ajeno', 5), clubId: 'club-2' }])

    await expect(
      stock.registerCount(CLUB, 7, {
        items: [
          { productId: 'agua', countedQuantity: 3 },
          { productId: 'ajeno', countedQuantity: 0 },
        ],
      }),
    ).rejects.toThrow('Producto ajeno no encontrado')
    expect(db.stockOf('agua')).toBe(10)
    expect(db.stockOf('ajeno')).toBe(5)
  })
})

/**
 * Kiosk stock is a Bandeja module. On a plan without it the API refuses STARTING to track a
 * product, and nothing else: products already tracked (a club moved down a plan) keep every
 * stock operation, and sales never ask.
 */
describe('kiosk stock and the plan', () => {
  it('refuses a delivery that would start tracking a product on a plan without stock', async () => {
    const { stock, db } = setup([product('agua', null)], [], { planHasStock: false })

    await expect(stock.registerPurchase(CLUB, 7, { items: [{ productId: 'agua', quantity: 24 }] })).rejects.toThrow(
      ForbiddenException,
    )
    expect(db.stockOf('agua')).toBeNull()
  })

  it('keeps deliveries and counts working for a product already tracked', async () => {
    const { stock, db } = setup([product('agua', 10)], [], { planHasStock: false })

    await stock.registerPurchase(CLUB, 7, { items: [{ productId: 'agua', quantity: 24 }] })
    await stock.registerCount(CLUB, 7, { items: [{ productId: 'agua', countedQuantity: 30 }] })

    expect(db.stockOf('agua')).toBe(30)
  })

  it('starts tracking on a plan with stock', async () => {
    const { stock, db } = setup([product('agua', null)])

    await stock.registerPurchase(CLUB, 7, { items: [{ productId: 'agua', quantity: 24 }] })

    expect(db.stockOf('agua')).toBe(24)
  })
})

/**
 * The point of sale: scanning builds a ticket (the panel adds one per scan, and a repeated
 * product may arrive as several lines) and "Cobrar" posts it as one counter sale; "Cargar
 * stock" posts the scanned delivery as one purchase. Each lands in the same ledger as the rest.
 */
describe('point of sale tickets', () => {
  it('charges a ticket of several products in one go: one sale per product, stock out, ledger linked', async () => {
    const { db, stock } = setup([product('agua', 20), product('coca', 10)])

    const sales = await stock.createCounterSale(CLUB, 7, {
      items: [
        { productId: 'agua', quantity: 1 },
        { productId: 'coca', quantity: 2 },
        { productId: 'agua', quantity: 1 },
      ],
      method: 'QR',
    })

    expect(sales).toHaveLength(2)
    expect(db.sales()).toEqual([
      expect.objectContaining({ productId: 'agua', quantity: 2, unitPriceCents: 200_000, method: 'QR', userId: 7 }),
      expect.objectContaining({ productId: 'coca', quantity: 2, unitPriceCents: 200_000, method: 'QR', userId: 7 }),
    ])
    // One ticket: every line carries the same moment.
    expect(db.sales()[0].createdAt).toBe(db.sales()[1].createdAt)
    expect(db.stockOf('agua')).toBe(18)
    expect(db.stockOf('coca')).toBe(8)
    expect(db.movements()).toEqual([
      expect.objectContaining({ productId: 'agua', type: 'SALE', quantity: -2, stockAfter: 18, counterSaleId: 'cs1' }),
      expect.objectContaining({ productId: 'coca', type: 'SALE', quantity: -2, stockAfter: 8, counterSaleId: 'cs2' }),
    ])
  })

  it('charges products without stock control too, without touching their stock', async () => {
    const { db, stock } = setup([product('agua', 20), product('paleta', null)])

    await stock.createCounterSale(CLUB, 7, {
      items: [
        { productId: 'agua', quantity: 1 },
        { productId: 'paleta', quantity: 1 },
      ],
      method: 'CASH',
    })

    expect(db.sales()).toHaveLength(2)
    expect(db.stockOf('paleta')).toBeNull()
    expect(db.movements()).toEqual([expect.objectContaining({ productId: 'agua', quantity: -1 })])
  })

  it('refuses a ticket with another club’s product and writes nothing', async () => {
    const { db, stock } = setup([product('agua', 20), { ...product('ajeno', 5), clubId: 'club-2' }])

    await expect(
      stock.createCounterSale(CLUB, 7, {
        items: [
          { productId: 'agua', quantity: 1 },
          { productId: 'ajeno', quantity: 1 },
        ],
        method: 'CASH',
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(db.sales()).toEqual([])
    expect(db.stockOf('agua')).toBe(20)
    expect(db.stockOf('ajeno')).toBe(5)
  })

  it('rolls the whole ticket back when a write fails halfway', async () => {
    const { db, stock } = setup([product('agua', 20), product('coca', 10)])
    db.client.counterSale.create.mockImplementationOnce(db.client.counterSale.create.getMockImplementation()!)
    db.client.counterSale.create.mockRejectedValueOnce(new Error('db down'))

    await expect(
      stock.createCounterSale(CLUB, 7, {
        items: [
          { productId: 'agua', quantity: 1 },
          { productId: 'coca', quantity: 1 },
        ],
        method: 'CASH',
      }),
    ).rejects.toThrow('db down')
    expect(db.sales()).toEqual([])
    expect(db.stockOf('agua')).toBe(20)
    expect(db.movements()).toEqual([])
  })

  it('pushes the owner once, after the sale, when the ticket takes a product to its minimum', async () => {
    const { notifications, stock } = setup([product('agua', 7, 5), product('coca', 30, 5)])

    await stock.createCounterSale(CLUB, 7, {
      items: [
        { productId: 'agua', quantity: 2 },
        { productId: 'coca', quantity: 1 },
      ],
      method: 'CASH',
    })

    expect(notifications.notifyOwners).toHaveBeenCalledTimes(1)
    expect(notifications.notifyOwners).toHaveBeenCalledWith(
      CLUB,
      expect.objectContaining({ body: 'Agua 500 ml: quedan 5' }),
    )
  })

  it('loads a scanned delivery of several products as PURCHASE lines, summing repeated scans', async () => {
    const { db, stock } = setup([product('agua', 4), product('coca', 0)])

    await stock.registerPurchase(CLUB, 7, {
      items: [
        { productId: 'agua', quantity: 6 },
        { productId: 'coca', quantity: 12 },
        { productId: 'agua', quantity: 6 },
      ],
      note: 'Distribuidora Rosario',
    })

    expect(db.stockOf('agua')).toBe(16)
    expect(db.stockOf('coca')).toBe(12)
    expect(db.movements()).toEqual([
      expect.objectContaining({
        productId: 'agua',
        type: 'PURCHASE',
        quantity: 12,
        stockAfter: 16,
        note: 'Distribuidora Rosario',
      }),
      expect.objectContaining({ productId: 'coca', type: 'PURCHASE', quantity: 12, stockAfter: 12, userId: 7 }),
    ])
  })
})

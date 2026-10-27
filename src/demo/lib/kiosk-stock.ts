import { shiftDateKey, wallTimeToUtc, weekdayOfKey } from '../../availability/lib/datetime'

/**
 * Stock plan of one demo product: its minimum, where it should stand when the demo is built,
 * how it's bought (pack size) and which weekdays (0 = Sunday) the supplier delivers.
 */
interface StockPlan {
  threshold: number
  final: number
  pack: number
  deliveryWeekdays: number[]
  supplier: string
  /** Most units a weekly count may come up short (a drink that "disappeared"). */
  maxShrink: number
}

/**
 * The tracked kiosk of Distrito Pádel. The paddle rental and the discontinued Powerade aren't
 * tracked (stock is opt-in per product). Agua and overgrips end below their minimum, so the
 * "para comprar" list and its push have something real to show.
 */
export const KIOSK_STOCK_PLAN: Record<string, StockPlan> = {
  head: { threshold: 6, final: 14, pack: 12, deliveryWeekdays: [1], supplier: 'Pedido a Head', maxShrink: 0 },
  bull: { threshold: 6, final: 11, pack: 12, deliveryWeekdays: [1], supplier: 'Pedido a Bullpadel', maxShrink: 0 },
  agua: { threshold: 24, final: 9, pack: 12, deliveryWeekdays: [1, 4], supplier: 'Distribuidora', maxShrink: 2 },
  saborizada: { threshold: 12, final: 22, pack: 12, deliveryWeekdays: [1, 4], supplier: 'Distribuidora', maxShrink: 1 },
  gatorade: { threshold: 12, final: 27, pack: 6, deliveryWeekdays: [1, 4], supplier: 'Distribuidora', maxShrink: 1 },
  coca: { threshold: 12, final: 31, pack: 12, deliveryWeekdays: [1, 4], supplier: 'Distribuidora', maxShrink: 2 },
  cerveza: { threshold: 24, final: 46, pack: 24, deliveryWeekdays: [1, 4], supplier: 'Distribuidora', maxShrink: 2 },
  barrita: { threshold: 10, final: 17, pack: 20, deliveryWeekdays: [1], supplier: 'Mayorista', maxShrink: 1 },
  alfajor: { threshold: 10, final: 23, pack: 24, deliveryWeekdays: [1], supplier: 'Mayorista', maxShrink: 1 },
  grip: { threshold: 6, final: 2, pack: 10, deliveryWeekdays: [1], supplier: 'Pedido a Bullpadel', maxShrink: 0 },
  munequera: { threshold: 2, final: 5, pack: 6, deliveryWeekdays: [1], supplier: 'Pedido a Bullpadel', maxShrink: 0 },
}

/** Units that left the shelf: a consumo on a turno or a counter sale. */
export interface LedgerSale {
  productKey: string
  quantity: number
  at: Date
  userId: number | null
  bookingId?: string
  counterSaleId?: string
}

export interface LedgerMovement {
  productKey: string
  type: 'PURCHASE' | 'SALE' | 'ADJUSTMENT'
  quantity: number
  stockAfter: number
  note: string | null
  userId: number | null
  bookingId: string | null
  counterSaleId: string | null
  createdAt: Date
}

export interface ProductStockState {
  stockQuantity: number
  lowStockThreshold: number
  lowStockNotifiedAt: Date | null
}

/**
 * Builds the kiosk's "entra / sale / queda" ledger for the demo history. It walks BACKWARD
 * from the stock each product should have today: every sale going back puts units on the
 * shelf, every delivery takes off what brought it up from a low-ish level. That way the final
 * numbers are exactly the plan, stock never goes negative and every row of the ledger adds up.
 */
export function buildKioskLedger(input: {
  sales: LedgerSale[]
  fromKey: string
  now: Date
  rand: () => number
  ownerId: number
  staffIds: number[]
}): { movements: LedgerMovement[]; states: Map<string, ProductStockState> } {
  const { rand, now } = input
  const randInt = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1))
  const staff = (): number => input.staffIds[randInt(0, input.staffIds.length - 1)] ?? input.ownerId
  // The first count happened the night before the history starts.
  const start = wallTimeToUtc(shiftDateKey(input.fromKey, -1), '23:30')

  const movements: LedgerMovement[] = []
  const states = new Map<string, ProductStockState>()

  for (const [productKey, plan] of Object.entries(KIOSK_STOCK_PLAN)) {
    type Draft = LedgerMovement & { isCount?: boolean }
    const events: Draft[] = input.sales
      .filter(s => s.productKey === productKey && s.at > start && s.at <= now)
      .map(s => ({
        productKey,
        type: 'SALE',
        quantity: -s.quantity,
        stockAfter: 0,
        note: s.counterSaleId ? 'Venta suelta' : 'Consumo del turno',
        userId: s.userId,
        bookingId: s.bookingId ?? null,
        counterSaleId: s.counterSaleId ?? null,
        createdAt: s.at,
      }))
    for (let dateKey = input.fromKey; ; dateKey = shiftDateKey(dateKey, 1)) {
      const delivery = wallTimeToUtc(dateKey, '11:00')
      if (delivery > now) break
      const base = { productKey, quantity: 0, stockAfter: 0, bookingId: null, counterSaleId: null }
      if (plan.deliveryWeekdays.includes(weekdayOfKey(dateKey))) {
        events.push({ ...base, type: 'PURCHASE', note: plan.supplier, userId: staff(), createdAt: delivery })
      }
      const closing = wallTimeToUtc(dateKey, '23:45')
      if (weekdayOfKey(dateKey) === 0 && closing <= now) {
        events.push({ ...base, type: 'ADJUSTMENT', note: 'Conteo', userId: staff(), createdAt: closing, isCount: true })
      }
    }
    events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    // Backward: `stock` is the level right after the event being visited.
    let stock = plan.final
    const kept: Draft[] = []
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]
      if (event.type === 'PURCHASE') {
        const lowLevel = randInt(Math.ceil(plan.threshold * 0.4), plan.threshold + Math.floor(plan.pack / 2))
        const units = Math.floor((stock - lowLevel) / plan.pack) * plan.pack
        if (units <= 0) continue // nothing to bring that day
        event.quantity = units
      } else if (event.isCount) {
        const r = rand()
        event.quantity = r < 0.22 && plan.maxShrink > 0 ? -randInt(1, plan.maxShrink) : r > 0.97 && stock > 0 ? 1 : 0
      }
      event.stockAfter = stock
      stock -= event.quantity
      kept.push(event)
    }
    kept.reverse()

    const initial: LedgerMovement = {
      productKey,
      type: 'ADJUSTMENT',
      quantity: stock,
      stockAfter: stock,
      note: 'Stock inicial',
      userId: input.ownerId,
      bookingId: null,
      counterSaleId: null,
      createdAt: start,
    }
    // Forward: when it last dropped to its minimum (the push the owner got), if it still is.
    let lowSince: Date | null = null
    for (const movement of [initial, ...kept]) {
      if (movement.stockAfter > plan.threshold) lowSince = null
      else lowSince ??= movement.createdAt
      movements.push(stripDraft(movement))
    }
    states.set(productKey, {
      stockQuantity: plan.final,
      lowStockThreshold: plan.threshold,
      lowStockNotifiedAt: lowSince,
    })
  }

  return { movements, states }
}

function stripDraft(movement: LedgerMovement & { isCount?: boolean }): LedgerMovement {
  const { isCount: _isCount, ...rest } = movement
  return rest
}

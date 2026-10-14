/** A consumo line reduced to what moves stock. */
export interface StockLine {
  productId: string
  quantity: number
}

/** Stock fields needed to decide whether a product belongs on the "para comprar" list. */
export interface StockLevel {
  stockQuantity: number | null
  lowStockThreshold: number | null
}

/**
 * True when a tracked product is at or below its minimum. With no minimum set the product
 * only counts as low once it runs out — an untracked product (null stock) never is.
 */
export function isLowStock({ stockQuantity, lowStockThreshold }: StockLevel): boolean {
  return stockQuantity !== null && stockQuantity <= (lowStockThreshold ?? 0)
}

/**
 * Net units each product changes by when a turno's consumos go from `before` to `after`:
 * negative = more was sold (stock goes down), positive = a consumo was removed or reduced
 * (stock comes back). Products whose total didn't change are left out, so re-saving a bill
 * untouched — or just re-splitting it among players — never moves stock.
 */
export function consumoDeltas(before: StockLine[], after: StockLine[]): Map<string, number> {
  const deltas = new Map<string, number>()
  for (const line of before) deltas.set(line.productId, (deltas.get(line.productId) ?? 0) + line.quantity)
  for (const line of after) deltas.set(line.productId, (deltas.get(line.productId) ?? 0) - line.quantity)
  for (const [productId, delta] of deltas) if (delta === 0) deltas.delete(productId)
  return deltas
}

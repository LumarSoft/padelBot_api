/**
 * The turno's bill ("cuenta del turno"): court price split across the 4 fixed player
 * positions plus each player's share of the consumos, minus what each one already put
 * in (the seña is credited to J1, quien reservó). Mirrors the panel's
 * `front/src/lib/booking-account.ts` — keep the math in sync.
 */

export interface AccountLine {
  unitPriceCents: number
  quantity: number
  /** Positions (1..4) of the players sharing this line's cost. */
  players: number[]
}

export interface PlayerPaymentLine {
  id: string
  playerSlot: number
  amountCents: number
  method: string
  createdAt: Date
}

export interface PlayerAccount {
  /** Position 1..4 (J1 = quien reservó). */
  slot: number
  owesCents: number
  /** Payments registered for this player (+ the seña for J1). */
  paidCents: number
  remainingCents: number
  /** Only J1: the paid deposit (transfer + applied credit) credited to them. */
  depositCreditedCents: number
}

export interface BookingAccountView {
  courtPriceCents: number
  consumosTotalCents: number
  totalCents: number
  /** Paid deposit credited to J1 (real transfer + player credit applied). */
  depositPaidCents: number
  /** Legacy aggregate front-desk collection not assigned to a player. */
  unassignedPaidCents: number
  paidCents: number
  remainingCents: number
  settledAt: Date | null
  players: [PlayerAccount, PlayerAccount, PlayerAccount, PlayerAccount]
  payments: PlayerPaymentLine[]
}

/** Splits cents into n non-negative integers summing exactly (no floats — money rule). */
export function splitEqually(totalCents: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(totalCents / n)
  const remainder = totalCents - base * n
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}

export function computeAccount(input: {
  courtPriceCents: number
  lines: AccountLine[]
  payments: PlayerPaymentLine[]
  /** Deposit actually paid (transfer detected/assigned + player credit applied). */
  depositPaidCents: number
  /** Legacy Booking.localPaymentCents (aggregate, not per player). */
  unassignedPaidCents: number
  settledAt: Date | null
}): BookingAccountView {
  const owes = splitEqually(input.courtPriceCents, 4)
  let consumosTotalCents = 0
  for (const line of input.lines) {
    const lineTotal = line.unitPriceCents * line.quantity
    consumosTotalCents += lineTotal
    if (line.players.length === 0) continue
    const shares = splitEqually(lineTotal, line.players.length)
    line.players.forEach((player, i) => {
      if (player >= 1 && player <= 4) owes[player - 1] += shares[i]
    })
  }

  const paidByPlayer = [0, 0, 0, 0]
  for (const payment of input.payments) {
    if (payment.playerSlot >= 1 && payment.playerSlot <= 4) {
      paidByPlayer[payment.playerSlot - 1] += payment.amountCents
    }
  }
  // The seña is J1's contribution — quien reservó ya puso su parte por adelantado.
  paidByPlayer[0] += input.depositPaidCents

  const players = owes.map((owesCents, i) => ({
    slot: i + 1,
    owesCents,
    paidCents: paidByPlayer[i],
    remainingCents: Math.max(0, owesCents - paidByPlayer[i]),
    depositCreditedCents: i === 0 ? input.depositPaidCents : 0,
  })) as BookingAccountView['players']

  const totalCents = input.courtPriceCents + consumosTotalCents
  const paidCents = paidByPlayer.reduce((s, p) => s + p, 0) + input.unassignedPaidCents

  return {
    courtPriceCents: input.courtPriceCents,
    consumosTotalCents,
    totalCents,
    depositPaidCents: input.depositPaidCents,
    unassignedPaidCents: input.unassignedPaidCents,
    paidCents,
    remainingCents: Math.max(0, totalCents - paidCents),
    settledAt: input.settledAt,
    players,
    payments: input.payments,
  }
}

import { DepositMode } from 'generated/prisma/client'

/** The club fields that decide whether the bot can close a booking money-wise. */
export interface PaymentSetupFields {
  depositMode: DepositMode
  transferAlias: string | null
  mpConnectedAt: Date | null
}

/** Prisma `select` for {@link paymentsConfigured}. */
export const paymentSetupSelect = { depositMode: true, transferAlias: true, mpConnectedAt: true } as const

/**
 * Whether the club's payment setup lets the bot take a booking end to end. A club that charges
 * up front (seña or full price) has to tell players WHERE to transfer: either its own MercadoPago
 * account is connected (auto-reconciled) or an alias is loaded (manual). A club on NONE charges
 * nothing through the bot, so there is nothing to configure — it is ready as is.
 */
export function paymentsConfigured(club: PaymentSetupFields): boolean {
  return club.depositMode === DepositMode.NONE || Boolean(club.mpConnectedAt) || Boolean(club.transferAlias)
}

import { Matches } from 'class-validator'

export class ConfirmCreditPackDto {
  /** The `payment_id` MercadoPago appends to the return URL. */
  @Matches(/^\d{1,20}$/, { message: 'paymentId must be a MercadoPago payment id' })
  paymentId: string
}

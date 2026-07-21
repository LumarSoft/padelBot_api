import { IsInt, IsNotEmpty, IsPositive, IsString } from 'class-validator'

/** Payload an external transfer-notification bridge POSTs when money is received. */
export class TransferNotificationDto {
  /** Amount received, in cents — matched against a pending booking's transferAmountCents. */
  @IsInt()
  @IsPositive()
  amountCents: number

  /** Source-unique id of the movement (for idempotency/audit), e.g. the bank/MP movement id. */
  @IsString()
  @IsNotEmpty()
  reference: string
}

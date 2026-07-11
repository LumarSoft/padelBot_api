import { IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Optional payload when the admin confirms a pending booking by ASSIGNING a concrete
 * detected transfer to it (the "casi-match" queue) — records the payment ref and the
 * payer identity so the confirmation is auditable and teaches reconciliation.
 */
export class AssignPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentRef?: string

  @IsOptional()
  @IsString()
  @MaxLength(20)
  payerCuit?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  payerEmail?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  payerMpUserId?: string
}

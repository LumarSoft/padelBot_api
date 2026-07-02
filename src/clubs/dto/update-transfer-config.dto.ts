import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { DepositMode, PaymentVerificationMode } from 'generated/prisma/client'

export class UpdateTransferConfigDto {
  /** MercadoPago alias/CVU players transfer the deposit to. Empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transferAlias?: string

  /** Account holder ("titular") shown to players alongside the alias. Empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transferHolder?: string

  /** DEPOSIT = charge a seña (depositPercent of the price); FULL = charge the whole court. */
  @IsOptional()
  @IsEnum(DepositMode)
  depositMode?: DepositMode

  /** Seña as a percentage of the court price (1–100). Only used when depositMode = DEPOSIT. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  depositPercent?: number

  /** Require the payer's DNI to match the reservation for auto-confirmation. */
  @IsOptional()
  @IsBoolean()
  requireDniMatch?: boolean

  /** AUTO = reconcile via MercadoPago; RECEIPT = player sends a receipt photo verified by hand. */
  @IsOptional()
  @IsEnum(PaymentVerificationMode)
  paymentVerificationMode?: PaymentVerificationMode
}

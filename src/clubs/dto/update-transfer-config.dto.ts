import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { DepositMode, PaymentVerificationMode, PlayerRescheduleMode } from 'generated/prisma/client'

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

  /**
   * Hours before the slot start within which cancelling forfeits the deposit.
   * Cancelling earlier than this turns the paid deposit into player credit.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  cancellationWindowHours?: number

  /**
   * What a player may do from WhatsApp when they can't make it. The bot never cancels — it
   * MOVES the booking, which keeps the deposit alive and frees the court for the waitlist.
   * SELF = the bot moves it; REQUEST = the staff is notified and decides; OFF = not offered.
   */
  @IsOptional()
  @IsEnum(PlayerRescheduleMode)
  playerReschedule?: PlayerRescheduleMode

  /**
   * Hours before the slot below which SELF degrades to REQUEST — too close to the start, a
   * freed court can no longer be resold, so a human decides. 0 = no cutoff.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  playerRescheduleCutoffHours?: number

  /** How many times ONE booking may be moved by the player (0 = never on their own). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxPlayerReschedules?: number
}

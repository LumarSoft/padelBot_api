import { Type } from 'class-transformer'
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import {
  BIGGEST_PAINS,
  CHARGES_DEPOSIT,
  CONTACT_WINDOWS,
  COURT_TYPES,
  CURRENT_SYSTEMS,
  FIXED_SLOTS,
  HAS_MERCADOPAGO,
  HOW_FOUND,
} from '../lib/signup-answers'

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Answers from the step-by-step signup at `/register`. Only the contact fields are
 * required: the front enforces which of its own steps must be answered, but a lead that
 * reaches the API half-filled is still a lead worth keeping, so nothing else rejects it.
 */
export class RequestClubDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  clubName: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ownerName: string

  @IsEmail()
  email: string

  /** WhatsApp/phone we'll contact them on to set the club up. */
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string

  // ── Operación ────────────────────────────────────────────────────────────────

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  courtCount?: number

  @IsOptional()
  @IsIn(COURT_TYPES as unknown as string[])
  courtType?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(240)
  slotDurationMinutes?: number

  @IsOptional()
  @Matches(TIME_REGEX, { message: 'openTime must be a valid HH:MM time' })
  openTime?: string

  @IsOptional()
  @Matches(TIME_REGEX, { message: 'closeTime must be a valid HH:MM time' })
  closeTime?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  avgPriceCents?: number

  // ── Cobros ───────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsIn(CHARGES_DEPOSIT as unknown as string[])
  chargesDeposit?: string

  @IsOptional()
  @IsIn(HAS_MERCADOPAGO as unknown as string[])
  hasMercadoPago?: string

  // ── Contexto comercial (todo salteable) ──────────────────────────────────────

  @IsOptional()
  @IsIn(CURRENT_SYSTEMS as unknown as string[])
  currentSystem?: string

  @IsOptional()
  @IsIn(BIGGEST_PAINS as unknown as string[])
  biggestPain?: string

  @IsOptional()
  @IsIn(FIXED_SLOTS as unknown as string[])
  fixedSlots?: string

  @IsOptional()
  @IsIn(HOW_FOUND as unknown as string[])
  howFound?: string

  @IsOptional()
  @IsIn(CONTACT_WINDOWS as unknown as string[])
  contactWindow?: string

  /** Free text when contactWindow = CUSTOM ("martes y jueves después de las 16"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactWindowNote?: string
}

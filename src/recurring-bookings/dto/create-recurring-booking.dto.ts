import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'

/**
 * "HH:MM" wall-clock band edge. NOT a fixed 90-minute grid: `Court.slotDurationMinutes` is per
 * court (60 for fútbol 5, 90 for pádel…), so a hardcoded list of valid times rejects perfectly
 * real bands. The service validates the pair against the court's own schedule
 * (`assertValidSlotPair`), which is the only source of truth for what bands exist.
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export class CreateRecurringBookingDto {
  @IsString()
  @MinLength(1)
  courtId: string

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number

  @Matches(HHMM, { message: 'slotStart debe tener el formato HH:MM' })
  slotStart: string

  @Matches(HHMM, { message: 'slotEnd debe tener el formato HH:MM' })
  slotEnd: string

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  playerName: string

  @IsString()
  @MinLength(6)
  @MaxLength(20)
  playerPhone: string

  @IsInt()
  @Min(0)
  priceCents: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string

  /** Block weekly occurrences only up to this club-local day ("YYYY-MM-DD"). Omit = rolling window. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'untilDate must be "YYYY-MM-DD"' })
  untilDate?: string
}

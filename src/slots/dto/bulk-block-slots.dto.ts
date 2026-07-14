import { ArrayNotEmpty, IsArray, IsISO8601, IsOptional, IsString, Matches } from 'class-validator'

/**
 * "HH:MM" wall-clock band start. NOT a fixed 90-minute grid: `Court.slotDurationMinutes` is
 * per court (60 for fútbol 5, 90 for pádel…), so a hardcoded list of valid starts rejects
 * perfectly real bands. The service matches these against each court's own schedule.
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export class BulkBlockSlotsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  courtIds: string[]

  /** Inclusive start date, "YYYY-MM-DD". */
  @IsISO8601()
  fromDate: string

  /** Inclusive end date, "YYYY-MM-DD". */
  @IsISO8601()
  toDate: string

  /** Subset of slot start times to act on. Omit for the whole day. */
  @IsOptional()
  @IsArray()
  @Matches(HHMM, { each: true, message: 'Cada horario debe tener el formato HH:MM' })
  slotStarts?: string[]
}

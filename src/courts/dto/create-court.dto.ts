import { IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import { CourtType } from 'generated/prisma/client'
import { WeeklyHours } from '../../availability/lib/schedule'

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export class CreateCourtDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string

  @IsInt()
  @Min(0)
  priceCents: number

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'openTime must be a valid HH:MM time' })
  openTime?: string

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'closeTime must be a valid HH:MM time' })
  closeTime?: string

  @IsOptional()
  @IsEnum(CourtType)
  courtType?: CourtType

  /** Band length in minutes (60/90/120…). Defaults to 90 (padel). */
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(240)
  slotDurationMinutes?: number

  /**
   * Per-weekday opening-hours overrides, keyed "0" (Sunday) … "6" (Saturday).
   * Shape is validated in CourtsService via parseWeeklyHours.
   */
  @IsOptional()
  @IsObject()
  weeklyHours?: WeeklyHours
}

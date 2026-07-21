import { IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import { CourtType } from 'generated/prisma/client'
import { WeeklyHours } from '../../availability/lib/schedule'

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export class UpdateCourtDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number

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

  /** Band length in minutes (60/90/120…). */
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(240)
  slotDurationMinutes?: number

  /**
   * Per-weekday opening-hours overrides ("0" = Sunday … "6" = Saturday). Send null to
   * clear every override. Shape is validated in CourtsService via parseWeeklyHours.
   */
  @IsOptional()
  @IsObject()
  weeklyHours?: WeeklyHours | null
}

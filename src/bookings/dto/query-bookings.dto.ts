import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator'
import { BookingStatus } from 'generated/prisma/client'

export class QueryBookingsDto {
  @IsOptional()
  @IsISO8601()
  from?: string

  @IsOptional()
  @IsISO8601()
  to?: string

  @IsOptional()
  @IsString()
  courtId?: string

  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus

  @IsOptional()
  @IsString()
  playerPhone?: string

  /** Global search: matches player name or phone (contains). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string
}

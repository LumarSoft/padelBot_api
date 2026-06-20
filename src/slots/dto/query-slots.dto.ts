import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator'
import { SlotStatus } from 'generated/prisma/client'

export class QuerySlotsDto {
  /** Inclusive lower bound on `startsAt`. */
  @IsOptional()
  @IsISO8601()
  from?: string

  /** Inclusive upper bound on `startsAt`. */
  @IsOptional()
  @IsISO8601()
  to?: string

  @IsOptional()
  @IsString()
  courtId?: string

  @IsOptional()
  @IsEnum(SlotStatus)
  status?: SlotStatus
}

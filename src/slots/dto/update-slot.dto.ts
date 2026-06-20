import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator'
import { SlotStatus } from 'generated/prisma/client'

export class UpdateSlotDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  courtId?: string

  @IsOptional()
  @IsISO8601()
  startsAt?: string

  @IsOptional()
  @IsISO8601()
  endsAt?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number

  @IsOptional()
  @IsEnum(SlotStatus)
  status?: SlotStatus
}

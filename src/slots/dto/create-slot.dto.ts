import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator'
import { SlotStatus } from 'generated/prisma/client'

export class CreateSlotDto {
  @IsString()
  @MinLength(1)
  courtId: string

  @IsISO8601()
  startsAt: string

  @IsISO8601()
  endsAt: string

  @IsInt()
  @Min(0)
  priceCents: number

  @IsOptional()
  @IsEnum(SlotStatus)
  status?: SlotStatus
}

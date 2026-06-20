import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'

export class UpdateRecurringBookingDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  playerName?: string

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  playerPhone?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

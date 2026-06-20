import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator'

export class CreateBookingDto {
  @IsString()
  @MinLength(1)
  slotId: string

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  playerName: string

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  playerPhone?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}

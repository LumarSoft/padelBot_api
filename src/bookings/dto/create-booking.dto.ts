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

  /** DNI (digits) captured for payer validation when the club requires it. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  playerDni?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}

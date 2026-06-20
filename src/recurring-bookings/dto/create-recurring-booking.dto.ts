import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

const VALID_SLOT_STARTS = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00', '22:30']
const VALID_SLOT_ENDS = ['10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00', '22:30', '00:00']

export class CreateRecurringBookingDto {
  @IsString()
  @MinLength(1)
  courtId: string

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number

  @IsIn(VALID_SLOT_STARTS)
  slotStart: string

  @IsIn(VALID_SLOT_ENDS)
  slotEnd: string

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  playerName: string

  @IsString()
  @MinLength(6)
  @MaxLength(20)
  playerPhone: string

  @IsInt()
  @Min(0)
  priceCents: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}

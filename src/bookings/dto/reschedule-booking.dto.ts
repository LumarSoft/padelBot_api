import { IsString, MinLength } from 'class-validator'

export class RescheduleBookingDto {
  @IsString()
  @MinLength(1)
  newSlotId: string
}

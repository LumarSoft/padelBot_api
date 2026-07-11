import { Type } from 'class-transformer'
import { IsIn, IsInt, Max, Min } from 'class-validator'

export class AddPlayerPaymentDto {
  /** Player position 1..4 (J1 = quien reservó). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  playerSlot: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents: number

  @IsIn(['CASH', 'QR', 'TRANSFER'])
  method: 'CASH' | 'QR' | 'TRANSFER'
}

import { Type } from 'class-transformer'
import { IsIn, IsInt, Min } from 'class-validator'

export class LocalPaymentDto {
  /** How the front desk collected it. */
  @IsIn(['CASH', 'QR'])
  method: 'CASH' | 'QR'

  /** Amount collected (cents). 0 clears the record. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountCents: number
}

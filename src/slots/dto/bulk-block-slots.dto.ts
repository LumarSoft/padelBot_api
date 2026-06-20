import { ArrayNotEmpty, IsArray, IsIn, IsISO8601, IsOptional, IsString } from 'class-validator'

const VALID_SLOT_STARTS = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00', '22:30']

export class BulkBlockSlotsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  courtIds: string[]

  /** Inclusive start date, "YYYY-MM-DD". */
  @IsISO8601()
  fromDate: string

  /** Inclusive end date, "YYYY-MM-DD". */
  @IsISO8601()
  toDate: string

  /** Subset of valid slot start times to block. Omit to block the whole day. */
  @IsOptional()
  @IsArray()
  @IsIn(VALID_SLOT_STARTS, { each: true })
  slotStarts?: string[]
}

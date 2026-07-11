import { Type } from 'class-transformer'
import { IsBoolean, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator'

export class BulkPriceAdjustDto {
  /** Percentage change, e.g. 10 = +10%, -5 = -5%. Zero is pointless → rejected. */
  @Type(() => Number)
  @IsNumber()
  @Min(-50)
  @Max(300)
  percent: number

  /** Preview only — compute the new prices without writing anything. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean

  /**
   * "YYYY-MM-DD" (club-local) the change takes effect. A FUTURE date schedules the
   * adjustment (applied by a daily job that morning) instead of applying it now.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'effectiveDate must be YYYY-MM-DD' })
  effectiveDate?: string
}

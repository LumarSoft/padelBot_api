import { IsOptional, Matches } from 'class-validator'

export class QueryCounterSalesDto {
  /** "YYYY-MM-DD" club-local day (default: today). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string
}

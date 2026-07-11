import { IsOptional, Matches } from 'class-validator'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export class RevenueQueryDto {
  /** "YYYY-MM-DD" club-local start day (default: 30 days ago). */
  @IsOptional()
  @Matches(DATE_KEY, { message: 'from must be YYYY-MM-DD' })
  from?: string

  /** "YYYY-MM-DD" club-local end day, inclusive (default: today). */
  @IsOptional()
  @Matches(DATE_KEY, { message: 'to must be YYYY-MM-DD' })
  to?: string
}

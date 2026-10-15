import { IsOptional, Matches } from 'class-validator'

export class ProfitabilityQueryDto {
  /** "2026-10". Defaults to the current club-local month. */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string
}

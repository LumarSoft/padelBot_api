import { IsOptional, IsString } from 'class-validator'

export class QueryAuditReportDto {
  /** Inclusive, "YYYY-MM-DD". Defaults to 30 days back. */
  @IsOptional()
  @IsString()
  from?: string

  /** Inclusive, "YYYY-MM-DD". Defaults to today. */
  @IsOptional()
  @IsString()
  to?: string
}

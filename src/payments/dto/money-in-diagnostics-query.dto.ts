import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

export class MoneyInDiagnosticsQueryDto {
  /** How far back to scan for incoming transfers, in minutes. Defaults to 60. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  minutes?: number
}

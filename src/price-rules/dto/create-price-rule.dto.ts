import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator'

export class CreatePriceRuleDto {
  /** "HH:MM" band start this price applies to. */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be "HH:MM"' })
  startTime: string

  /** Price (cents) for the band. */
  @IsInt()
  @Min(0)
  priceCents: number

  /** 0 = Sunday … 6 = Saturday. Omit / null = applies every day. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number | null
}

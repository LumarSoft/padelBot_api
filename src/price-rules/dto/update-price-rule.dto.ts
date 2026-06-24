import { IsInt, Min } from 'class-validator'

export class UpdatePriceRuleDto {
  /** New price (cents) for the rule. */
  @IsInt()
  @Min(0)
  priceCents: number
}

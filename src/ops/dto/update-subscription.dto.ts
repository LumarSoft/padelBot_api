import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { SubscriptionStatus } from 'generated/prisma/client'

/**
 * The UI equivalent of `npm run subscription`. Billing is manual: a transfer arrives, we
 * flip the club to ACTIVE for N months. This is that, without SSHing into the box.
 */
export class UpdateSubscriptionDto {
  @IsEnum(SubscriptionStatus)
  status: SubscriptionStatus

  /** With ACTIVE: paid months from now → currentPeriodEnd. Default 1. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number

  /** With TRIAL: trial days from now → trialEndsAt. Default 14. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  days?: number

  @IsOptional()
  @IsString()
  @MaxLength(40)
  plan?: string
}

import { Type } from 'class-transformer'
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import { SubscriptionStatus } from 'generated/prisma/client'
import { PLAN_KEYS, PlanKey } from '../../plans/lib/plans'

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

  /** With TRIAL: trial days from now → trialEndsAt. Default 15, the trial the landing promises. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  days?: number

  /** saque | bandeja | smash. Omit to keep the club's plan. */
  @IsOptional()
  @IsIn(PLAN_KEYS)
  plan?: PlanKey

  /** false once a plan is agreed with a club that predates the plans: it then gets only its
   *  plan's modules. true gives a club every module whatever its plan. */
  @IsOptional()
  @IsBoolean()
  grandfatheredFeatures?: boolean
}

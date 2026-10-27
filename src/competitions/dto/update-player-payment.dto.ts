import { IsBoolean, IsEnum, IsOptional } from 'class-validator'
import { PlayerPaymentMethod } from 'generated/prisma/client'

export class UpdatePlayerPaymentDto {
  @IsBoolean()
  paid: boolean

  /** How they paid; defaults to CASH when marking paid. */
  @IsOptional()
  @IsEnum(PlayerPaymentMethod)
  method?: PlayerPaymentMethod
}

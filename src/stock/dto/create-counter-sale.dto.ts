import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { PlayerPaymentMethod } from 'generated/prisma/client'

export class CounterSaleItemDto {
  @IsString()
  productId: string

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number
}

/** "Venta suelta": kiosk products sold outside any turno, paid on the spot. */
export class CreateCounterSaleDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CounterSaleItemDto)
  items: CounterSaleItemDto[]

  @IsEnum(PlayerPaymentMethod)
  method: PlayerPaymentMethod
}

import { Type } from 'class-transformer'
import { ArrayNotEmpty, IsArray, IsInt, IsString, Max, Min, ValidateNested } from 'class-validator'

export class BookingProductItemDto {
  @IsString()
  productId: string

  @IsInt()
  @Min(1)
  quantity: number

  /** Positions (1..4) of the players sharing this consumo line. [1,2,3,4] = split among all four. */
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(4, { each: true })
  players: number[]
}

export class SetBookingProductsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingProductItemDto)
  items: BookingProductItemDto[]
}

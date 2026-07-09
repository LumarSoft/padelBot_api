import { Type } from 'class-transformer'
import { ArrayNotEmpty, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator'

export class BookingProductItemDto {
  @IsString()
  productId: string

  @IsInt()
  @Min(1)
  quantity: number
}

export class SetBookingProductsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingProductItemDto)
  items: BookingProductItemDto[]
}

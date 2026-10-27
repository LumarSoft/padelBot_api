import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class PurchaseItemDto {
  @IsString()
  productId: string

  /** Units that came in. */
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity: number
}

/** "Entró mercadería": one delivery, many products. */
export class RegisterPurchaseDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[]

  /** Free text, e.g. the supplier or the invoice number. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string
}

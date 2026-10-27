import { Transform } from 'class-transformer'
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { ProductCategory } from 'generated/prisma/client'
import { BARCODE_PATTERN, normalizeBarcode } from '../lib/barcode'

export class CreateProductDto {
  @IsString()
  @MaxLength(100)
  name: string

  @IsInt()
  @Min(0)
  priceCents: number

  @IsEnum(ProductCategory)
  @IsOptional()
  category?: ProductCategory

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  /** What the counter's barcode scanner reads. Blank or omitted = no code. */
  @Transform(({ value }) => normalizeBarcode(value))
  @IsOptional()
  @IsString()
  @Matches(BARCODE_PATTERN, { message: 'El código de barras no es válido' })
  barcode?: string | null

  /** Units on hand to start tracking stock with. Omit to not track stock for this product. */
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  stockQuantity?: number

  /** "Para comprar" at this many units or fewer. Null/omitted = only when it runs out. */
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  lowStockThreshold?: number | null
}

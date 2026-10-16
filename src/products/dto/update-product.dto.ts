import { Transform } from 'class-transformer'
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { ProductCategory } from 'generated/prisma/client'
import { BARCODE_PATTERN, normalizeBarcode } from '../lib/barcode'

export class UpdateProductDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string

  @IsInt()
  @Min(0)
  @IsOptional()
  priceCents?: number

  @IsEnum(ProductCategory)
  @IsOptional()
  category?: ProductCategory

  @IsBoolean()
  @IsOptional()
  isActive?: boolean

  /** What the counter's barcode scanner reads. Null or blank removes the code. */
  @Transform(({ value }) => normalizeBarcode(value))
  @IsOptional()
  @IsString()
  @Matches(BARCODE_PATTERN, { message: 'El código de barras no es válido' })
  barcode?: string | null

  /**
   * Corrected units on hand, recorded as an adjustment in the stock ledger. Null stops
   * tracking stock for this product.
   */
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  stockQuantity?: number | null

  /** "Para comprar" at this many units or fewer. Null = only when it runs out. */
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  lowStockThreshold?: number | null
}

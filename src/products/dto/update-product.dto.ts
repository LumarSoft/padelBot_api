import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ProductCategory } from 'generated/prisma/client'

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

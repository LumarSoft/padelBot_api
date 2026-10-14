import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ProductCategory } from 'generated/prisma/client'

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

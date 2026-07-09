import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'
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
}

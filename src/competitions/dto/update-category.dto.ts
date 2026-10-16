import { CategoryFormat } from 'generated/prisma/client'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator'

/** Same fields as CreateCategoryDto, all optional. Only editable before the category's fixture. */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string

  @IsOptional()
  @IsEnum(CategoryFormat)
  format?: CategoryFormat

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(8)
  groupSize?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  advancePerGroup?: number

  /** null removes the cap. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(2)
  @Max(128)
  maxPairs?: number | null
}

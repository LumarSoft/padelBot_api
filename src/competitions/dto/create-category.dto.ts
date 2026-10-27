import { CategoryFormat } from 'generated/prisma/client'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string

  @IsEnum(CategoryFormat)
  format: CategoryFormat

  /** Target pairs per zona (GROUPS_KNOCKOUT). */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(8)
  groupSize?: number

  /** Pairs of each zona that go on to the bracket (GROUPS_KNOCKOUT). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  advancePerGroup?: number

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(128)
  maxPairs?: number
}

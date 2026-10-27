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

export class CountItemDto {
  @IsString()
  productId: string

  /** Units physically on the shelf right now. */
  @IsInt()
  @Min(0)
  @Max(100000)
  countedQuantity: number
}

/** "Contar stock": the real quantity of each counted product. Products left out aren't touched. */
export class RegisterCountDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CountItemDto)
  items: CountItemDto[]

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string
}

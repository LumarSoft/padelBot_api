import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { PairPlayerDto } from './create-pair.dto'

export class UpdatePairDto {
  /** Moving a pair to another category is only possible before that category's fixture. */
  @IsOptional()
  @IsString()
  categoryId?: string

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => PairPlayerDto)
  players?: PairPlayerDto[]

  /** null clears the seed. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(999)
  seed?: number | null
}

import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class PairPlayerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string

  /** Optional: with a phone the player is linked to (or added to) the club's players. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string
}

export class CreatePairDto {
  /** Required for a torneo; a peña uses its only category. */
  @IsOptional()
  @IsString()
  categoryId?: string

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => PairPlayerDto)
  players: PairPlayerDto[]

  /** 1 = best. Omit to order by registration. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  seed?: number
}

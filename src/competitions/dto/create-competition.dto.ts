import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { CompetitionKind, MatchFormat } from 'generated/prisma/client'
import { CreateCategoryDto } from './create-category.dto'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** One time window when the event holds its courts. An end at or before the start ends past midnight. */
export class CompetitionSessionDto {
  @Matches(DATE_KEY, { message: 'dateKey debe tener el formato YYYY-MM-DD' })
  dateKey: string

  @Matches(HHMM, { message: 'startTime debe tener el formato HH:MM' })
  startTime: string

  @Matches(HHMM, { message: 'endTime debe tener el formato HH:MM' })
  endTime: string
}

export class CreateCompetitionDto {
  @IsEnum(CompetitionKind)
  kind: CompetitionKind

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  /** Defaults to ONE_SET (americano / peña). */
  @IsOptional()
  @IsEnum(MatchFormat)
  matchFormat?: MatchFormat

  /** Registration fee per player, in cents. */
  @IsOptional()
  @IsInt()
  @Min(0)
  entryFeeCents?: number

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  courtIds: string[]

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => CompetitionSessionDto)
  sessions: CompetitionSessionDto[]

  /** Torneo only (at least one). A peña always gets a single round-robin "General". */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CreateCategoryDto)
  categories?: CreateCategoryDto[]
}

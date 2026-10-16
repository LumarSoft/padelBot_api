import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { CompetitionStatus, MatchFormat } from 'generated/prisma/client'
import { CompetitionSessionDto } from './create-competition.dto'

export class UpdateCompetitionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @IsOptional()
  @IsEnum(MatchFormat)
  matchFormat?: MatchFormat

  @IsOptional()
  @IsInt()
  @Min(0)
  entryFeeCents?: number

  /** Replaces the courts; the blocked turnos follow. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  courtIds?: string[]

  /** Replaces the sessions; the blocked turnos follow. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => CompetitionSessionDto)
  sessions?: CompetitionSessionDto[]

  /** Mark it finished (or reopen it). Cancelling goes through POST /competitions/:id/cancel. */
  @IsOptional()
  @IsIn([CompetitionStatus.OPEN, CompetitionStatus.IN_PROGRESS, CompetitionStatus.FINISHED])
  status?: CompetitionStatus
}

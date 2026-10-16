import { IsEnum, IsOptional } from 'class-validator'
import { CompetitionKind, CompetitionStatus } from 'generated/prisma/client'

export class QueryCompetitionsDto {
  @IsOptional()
  @IsEnum(CompetitionKind)
  kind?: CompetitionKind

  @IsOptional()
  @IsEnum(CompetitionStatus)
  status?: CompetitionStatus
}

import { IsEnum, IsOptional } from 'class-validator'
import { ImprovementSuggestionStatus } from 'generated/prisma/client'

export class ListImprovementSuggestionsQueryDto {
  @IsOptional()
  @IsEnum(ImprovementSuggestionStatus)
  status?: ImprovementSuggestionStatus
}

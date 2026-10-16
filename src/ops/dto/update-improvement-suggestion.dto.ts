import { IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator'
import { ImprovementSuggestionStatus } from 'generated/prisma/client'

/** What we did with a club's suggestion. Every field is optional; null clears it. */
export class UpdateImprovementSuggestionDto {
  @IsOptional()
  @IsEnum(ImprovementSuggestionStatus)
  status?: ImprovementSuggestionStatus

  /** Our answer, shown to the club. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  opsReply?: string | null

  /** The posted improvement that answers it. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(191)
  improvementId?: string | null
}

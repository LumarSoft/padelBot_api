import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'

export class UpdateClubNotesDto {
  /** Our notes on the club; empty or null clears them. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(8000)
  opsNotes: string | null
}

import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class UpdateClubProfileDto {
  /** Display name of the club / complex. */
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string

  /** Extra line the bot appends to its welcome (reglas de la casa, tono propio). Empty clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  botWelcomeExtra?: string

  /** "Cómo llegar": address / landmarks / maps link the bot answers on request. Empty clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  locationInfo?: string
}

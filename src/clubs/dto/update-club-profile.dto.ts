import { IsString, MaxLength, MinLength } from 'class-validator'

export class UpdateClubProfileDto {
  /** Display name of the club / complex. */
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string
}

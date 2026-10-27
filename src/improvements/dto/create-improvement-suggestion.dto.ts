import { IsString, MaxLength, MinLength } from 'class-validator'

/** An improvement a club's owner or staff proposes to Lumarsoft. */
export class CreateImprovementSuggestionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  body: string
}

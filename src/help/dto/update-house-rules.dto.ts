import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator'

/** One house rule: a desk question and the club's own answer. */
export class HouseRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  question: string

  /** Kept short on purpose: the help shows answers of three lines at most. */
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  answer: string
}

/** The whole list, replaced as a set (the panel edits it wholesale, like the bot FAQ). */
export class UpdateHouseRulesDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => HouseRuleDto)
  entries: HouseRuleDto[]
}

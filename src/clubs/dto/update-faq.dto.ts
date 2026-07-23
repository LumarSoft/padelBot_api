import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator'

/** One FAQ entry: a player question and the answer the bot should give. */
export class FaqEntryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  question: string

  @IsString()
  @MinLength(1)
  @MaxLength(600)
  answer: string
}

/**
 * The whole FAQ list, replaced as a set (the panel edits it wholesale). Bounded in size and
 * per-field length so it can't bloat the LLM prompt / OpenAI cost.
 */
export class UpdateFaqDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => FaqEntryDto)
  entries: FaqEntryDto[]
}

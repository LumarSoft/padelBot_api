import { IsString, MaxLength, MinLength } from 'class-validator'

/** A help search that found nothing, as the user typed it (normalized server-side). */
export class RecordSearchMissDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  query: string
}

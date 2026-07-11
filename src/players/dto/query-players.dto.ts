import { IsOptional, IsString, MaxLength } from 'class-validator'

export class QueryPlayersDto {
  /** Matches name or phone (contains). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string
}

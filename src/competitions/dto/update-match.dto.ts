import { ArrayMaxSize, IsArray, IsISO8601, IsOptional, IsString, ValidateIf } from 'class-validator'

export class UpdateMatchDto {
  /**
   * Games per set from pair A's side, e.g. [[6,4],[3,6],[10,8]]. null clears the result. The
   * shape and the winner are checked against the event's match format by the service.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(3)
  sets?: number[][] | null

  /** null clears the court. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  courtId?: string | null

  /** ISO instant; null clears it. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  startsAt?: string | null
}

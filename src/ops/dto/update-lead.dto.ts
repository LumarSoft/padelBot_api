import { IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'
import { LEAD_STATUSES, LOST_REASONS } from '../lib/lead-status'

export class UpdateLeadDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES as unknown as string[])
  status?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  internalNotes?: string

  /** When to call them back (ISO date-time); null clears it. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  followUpAt?: string | null

  /** Why we lost it (with status LOST); null clears it. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(LOST_REASONS as unknown as string[])
  lostReason?: string | null
}

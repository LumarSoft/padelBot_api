import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { LEAD_STATUSES } from '../lib/lead-status'

export class UpdateLeadDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES as unknown as string[])
  status?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  internalNotes?: string
}

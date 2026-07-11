import { IsIn, IsOptional } from 'class-validator'
import { LEAD_STATUSES, LeadStatus } from '../lib/lead-status'

export class ListLeadsQueryDto {
  /** Omitted = the whole pipeline. */
  @IsOptional()
  @IsIn(LEAD_STATUSES as unknown as string[])
  status?: LeadStatus
}

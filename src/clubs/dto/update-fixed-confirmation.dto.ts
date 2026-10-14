import { IsBoolean, IsIn, IsOptional } from 'class-validator'

/** Hours before the turno the panel offers for the fijo's "¿venís?" (24 = the day before). */
export const FIXED_CONFIRMATION_LEAD_HOURS = [3, 6, 12, 24, 48] as const

export class UpdateFixedConfirmationDto {
  /** Turns the automatic "¿venís?" to the fijos on or off. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  /**
   * How many hours before the turno the question goes out. A closed set: under 3 hours a freed
   * court can hardly be resold and the 1h reminder is about to go out anyway.
   */
  @IsOptional()
  @IsIn(FIXED_CONFIRMATION_LEAD_HOURS)
  leadHours?: number
}

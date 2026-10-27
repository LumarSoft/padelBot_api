import { IsBoolean } from 'class-validator'

export class SetAttendanceDto {
  /** true = the fijo is coming; false = they're not ("no viene"): releases only this date. */
  @IsBoolean()
  confirmed: boolean
}

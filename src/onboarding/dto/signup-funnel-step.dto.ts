import { IsInt, Matches, Max, Min } from 'class-validator'

/** One `/register` screen seen: its id and its position in the flow. Nothing about who. */
export class SignupFunnelStepDto {
  /** A question id ("club", "courtCount"…), "summary" or "sent". */
  @Matches(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/)
  step: string

  @IsInt()
  @Min(0)
  @Max(60)
  index: number
}

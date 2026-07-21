import { ArrayMaxSize, IsArray, IsIn, IsOptional } from 'class-validator'
import { SETUP_STEP_IDS, SetupStepId } from '../lib/setup-steps'

export class SaveSetupProgressDto {
  /** Step the wizard is standing on, so it can resume there. Null clears the position. */
  @IsOptional()
  @IsIn(SETUP_STEP_IDS as unknown as string[])
  currentStep?: SetupStepId | null

  /** Steps the owner moved past — including the ones they deliberately skipped. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SETUP_STEP_IDS.length)
  @IsIn(SETUP_STEP_IDS as unknown as string[], { each: true })
  doneSteps?: SetupStepId[]
}

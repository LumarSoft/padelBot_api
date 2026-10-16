import { IsEnum } from 'class-validator'
import { SignupRequestStatus } from 'generated/prisma/client'

export class UpdateSignupRequestDto {
  /** HANDLED once someone talked to the player, DISMISSED to drop it, PENDING to bring it back. */
  @IsEnum(SignupRequestStatus)
  status: SignupRequestStatus
}

import { IsEnum, IsOptional, IsString } from 'class-validator'
import { SignupRequestStatus } from 'generated/prisma/client'

export class QuerySignupRequestsDto {
  @IsOptional()
  @IsEnum(SignupRequestStatus)
  status?: SignupRequestStatus

  @IsOptional()
  @IsString()
  competitionId?: string
}

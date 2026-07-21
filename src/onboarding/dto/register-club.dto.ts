import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
} from '../../common/password'

export class RegisterClubDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  clubName: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ownerName: string

  @IsEmail()
  email: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE })
  password: string
}

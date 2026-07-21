import { IsEmail, IsString, MinLength } from 'class-validator'

export class OpsLoginDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(1)
  password: string
}

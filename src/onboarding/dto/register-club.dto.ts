import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'

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
  @MinLength(8)
  @MaxLength(72)
  password: string
}

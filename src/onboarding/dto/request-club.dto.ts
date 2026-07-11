import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class RequestClubDto {
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

  /** WhatsApp/phone we'll contact them on to set the club up. */
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string
}

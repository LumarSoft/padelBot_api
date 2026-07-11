import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { Role } from 'generated/prisma/client'

export class CreateUserDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string

  @IsOptional()
  @IsEnum(Role)
  role?: Role
}

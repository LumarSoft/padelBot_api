import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class UpdatePlayerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

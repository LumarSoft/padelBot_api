import { IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator'
import { CourtType } from 'generated/prisma/client'

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export class UpdateCourtDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'openTime must be a valid HH:MM time' })
  openTime?: string

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'closeTime must be a valid HH:MM time' })
  closeTime?: string

  @IsOptional()
  @IsEnum(CourtType)
  courtType?: CourtType
}

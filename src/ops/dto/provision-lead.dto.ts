import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

/**
 * Provisioning a club straight from a lead. Everything except the password defaults to
 * what the prospect already told us in the signup — that was the whole point of asking.
 */
export class ProvisionLeadDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string

  /** Override the club name from the lead (typos, "Padel Center SRL" → "Padel Center"). */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  clubName?: string

  /** Override the owner's login email (the one they gave may be a shared info@). */
  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ownerName?: string
}

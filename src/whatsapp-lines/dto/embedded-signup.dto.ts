import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator'

/**
 * What the panel gets back from Meta's Embedded Signup popup: the one-time `code` (from
 * FB.login, 30s TTL) plus the asset ids from the WA_EMBEDDED_SIGNUP session message.
 */
export class EmbeddedSignupDto {
  @IsString()
  @IsNotEmpty()
  code: string

  @IsString()
  @Matches(/^\d+$/)
  wabaId: string

  /** Absent on coexistence finishes (Meta only sends the WABA) — the API looks it up. */
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  phoneNumberId?: string

  /** True when the flow finished as FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (coexistence). */
  @IsOptional()
  @IsBoolean()
  coexistence?: boolean
}

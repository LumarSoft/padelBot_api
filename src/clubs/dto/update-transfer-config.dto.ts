import { IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateTransferConfigDto {
  /** MercadoPago alias/CVU players transfer the deposit to. Empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transferAlias?: string

  /** Account holder ("titular") shown to players alongside the alias. Empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transferHolder?: string
}

import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ImprovementStatus } from 'generated/prisma/client'

export class UpdateImprovementDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body?: string

  @IsOptional()
  @IsEnum(ImprovementStatus)
  status?: ImprovementStatus

  /** True publishes it (keeps the first publish date); false takes it back to draft. */
  @IsOptional()
  @IsBoolean()
  published?: boolean
}

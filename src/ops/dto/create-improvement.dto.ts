import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ImprovementStatus } from 'generated/prisma/client'

/** An improvement we post for every club. */
export class CreateImprovementDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body: string

  /** Defaults to RELEASED: most posts are "we shipped this". */
  @IsOptional()
  @IsEnum(ImprovementStatus)
  status?: ImprovementStatus

  /** True publishes it now; false/absent keeps it as a draft. */
  @IsOptional()
  @IsBoolean()
  published?: boolean
}

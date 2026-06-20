import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'

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
}

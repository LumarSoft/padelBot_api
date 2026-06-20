import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator'

export class CreateCourtDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string

  @IsInt()
  @Min(0)
  priceCents: number
}

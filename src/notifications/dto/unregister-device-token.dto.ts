import { IsString, MinLength } from 'class-validator'

export class UnregisterDeviceTokenDto {
  @IsString()
  @MinLength(1)
  token: string
}

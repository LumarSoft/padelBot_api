import { IsIn, IsString, MinLength } from 'class-validator'

export class RegisterDeviceTokenDto {
  @IsString()
  @MinLength(1)
  token: string

  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android'
}

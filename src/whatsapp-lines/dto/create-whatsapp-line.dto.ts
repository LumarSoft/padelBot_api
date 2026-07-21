import { IsNotEmpty, IsString } from 'class-validator'

export class CreateWhatsAppLineDto {
  @IsString()
  @IsNotEmpty()
  phoneNumberId: string

  @IsString()
  @IsNotEmpty()
  displayPhone: string
}

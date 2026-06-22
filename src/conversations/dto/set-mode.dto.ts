import { IsIn } from 'class-validator'

export class SetModeDto {
  @IsIn(['AI', 'HUMAN'])
  mode: 'AI' | 'HUMAN'
}

import { IsIn } from 'class-validator'
import { CREDIT_PACK_KEYS } from '../lib/credit-packs'

export class BuyCreditPackDto {
  /** pack-500 | pack-1000 | pack-2500 */
  @IsIn(CREDIT_PACK_KEYS)
  packKey: string
}

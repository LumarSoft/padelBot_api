import { Transform } from 'class-transformer'
import { IsString, Matches } from 'class-validator'
import { BARCODE_PATTERN, normalizeBarcode } from '../lib/barcode'

export class FindByBarcodeDto {
  /** The code the scanner read. */
  @Transform(({ value }) => normalizeBarcode(value))
  @IsString()
  @Matches(BARCODE_PATTERN, { message: 'El código de barras no es válido' })
  code: string
}

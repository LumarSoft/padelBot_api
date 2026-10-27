/**
 * A barcode as the counter's scanner types it: printable ASCII with no spaces (the EAN/UPC
 * digits on a bottle, or a Code 128 the club printed itself), up to 64 characters.
 */
export const BARCODE_PATTERN = /^[\x21-\x7E]{1,64}$/

/**
 * Trims what the scanner (or someone typing) sent; blank means "no code" (null). Anything that
 * isn't a string is passed through untouched so the validators reject it.
 */
export function normalizeBarcode(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Phone helpers for numbers typed by hand in the panel. A fijo's phone is whatever the front
 * desk wrote ("341 555-1234", "0341 15 555 1234", "+54 9 341 5551234"), while WhatsApp names
 * the player by wa_id ("5493415551234"). For Argentina all of them reduce to the same 10-digit
 * national number: area code + subscriber, without the 0 trunk prefix, the old 15 mobile
 * prefix or the 54 / 9 country and mobile prefixes. No Argentine area code starts with 5, so
 * a leading 54 is always the country code.
 */

function digitsOf(raw?: string | null): string {
  return (raw ?? '').replace(/\D/g, '')
}

/** The 10-digit Argentine national number for a phone, or null when it can't be derived. */
export function nationalArPhone(raw?: string | null): string | null {
  let digits = digitsOf(raw)
  if (digits.startsWith('549') && digits.length >= 13) digits = digits.slice(3)
  else if (digits.startsWith('54') && digits.length >= 12) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)

  if (digits.length === 10) return digits
  if (digits.length === 12) {
    // "341 15 5551234": the 15 sits right after the area code, which is 2 to 4 digits long.
    for (const areaLength of [3, 2, 4]) {
      if (digits.slice(areaLength, areaLength + 2) === '15') {
        return digits.slice(0, areaLength) + digits.slice(areaLength + 2)
      }
    }
  }
  return null
}

/**
 * The number to WhatsApp for a hand-typed phone: the wa_id form for Argentina, or the digits as
 * typed when they already look international (another country). Null = can't be messaged.
 */
export function whatsAppRecipient(raw?: string | null): string | null {
  const national = nationalArPhone(raw)
  if (national) return `549${national}`
  const digits = digitsOf(raw)
  return digits.length >= 11 ? digits : null
}

/** True when two phones (any of the formats above, or a wa_id) are the same line. */
export function samePhone(a?: string | null, b?: string | null): boolean {
  const nationalA = nationalArPhone(a)
  const nationalB = nationalArPhone(b)
  if (nationalA && nationalB) return nationalA === nationalB
  const digitsA = digitsOf(a)
  return digitsA.length > 0 && digitsA === digitsOf(b)
}

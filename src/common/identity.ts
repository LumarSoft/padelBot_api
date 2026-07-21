/**
 * Identity helpers for matching a transfer's payer against a reservation.
 *
 * Argentine IDs: a DNI is 7–8 digits. A CUIT/CUIL is 11 digits formed as
 * `PP DDDDDDDD C` — a 2-digit prefix, the 8-digit DNI, and a check digit. So the
 * DNI is the middle 8 digits of the CUIT. We compare DNIs in a canonical form
 * (digits only, no leading zeros) so "04765283", "4765283" and "4.765.283" all match.
 */

/** Canonical DNI (digits only, no leading zeros) from free text, or null if not 7–8 digits. */
export function normalizeDni(raw?: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 8) return null
  return String(parseInt(digits, 10))
}

/**
 * Extracts the canonical DNI from a payer's identification number. An 11-digit value is a
 * CUIT/CUIL (the DNI is its middle 8 digits); a 7–8 digit value is already a DNI. Inferred
 * by length, so it works even when MercadoPago omits the `type`. Returns null otherwise.
 */
export function dniFromIdentification(number?: string | null): string | null {
  if (!number) return null
  const digits = number.replace(/\D/g, '')
  if (digits.length === 11) return normalizeDni(digits.slice(2, 10))
  return normalizeDni(digits)
}

/** True when two DNIs refer to the same person (canonical comparison). */
export function dniMatches(a?: string | null, b?: string | null): boolean {
  const na = normalizeDni(a)
  const nb = normalizeDni(b)
  return na !== null && nb !== null && na === nb
}

/** Longest search we keep — the column is VARCHAR(80). */
export const HELP_QUERY_MAX = 80

/**
 * Normalizes a help search so "¿Cómo COBRO?" and "como cobro" count as the same miss:
 * lowercase, accents (and the ñ's tilde: "sena" is how people type it) and punctuation stripped,
 * whitespace collapsed, capped at 80 chars.
 */
export function normalizeHelpQuery(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HELP_QUERY_MAX)
    .trim()
}

/**
 * Whether a normalized search is worth logging. Too short says nothing, and a long run of
 * digits is a phone or a DNI someone pasted in the wrong box — personal data that has no
 * business in a list we read across clubs.
 */
export function isLoggableHelpQuery(query: string): boolean {
  return query.length >= 3 && !/\d{6,}/.test(query.replace(/ /g, ''))
}

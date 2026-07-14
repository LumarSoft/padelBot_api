/**
 * The one password policy of the product. The panel shows these same rules live under the
 * field (`front/src/lib/password.ts`) — keep both in sync, or the user gets a 400 for a rule
 * nobody ever told them about.
 *
 * bcrypt silently truncates at 72 bytes, hence the max.
 */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 72

/** At least one letter and one digit. */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/

export const PASSWORD_RULE_MESSAGE = 'La contraseña necesita al menos 8 caracteres, una letra y un número'

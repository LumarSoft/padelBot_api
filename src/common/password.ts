import * as bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'

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

const BCRYPT_ROUNDS = 10

/**
 * URL-safe 12-char temporary password. Satisfies PASSWORD_PATTERN by construction — a random
 * base64url string can (rarely) be all letters or all digits, so we seed a letter and a digit.
 */
export function generateTempPassword(): string {
  return `a7${randomBytes(9).toString('base64url')}`
}

/** Hashes a plaintext password for storage at rest. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

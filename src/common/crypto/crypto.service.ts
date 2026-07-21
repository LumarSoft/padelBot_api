import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Symmetric encryption for secrets stored at rest (e.g. each club's MercadoPago
 * OAuth tokens). Uses AES-256-GCM, which is authenticated — a tampered ciphertext
 * fails to decrypt instead of returning garbage.
 *
 * The key comes from `ENCRYPTION_KEY` (64 hex chars = 32 bytes). Generate one with:
 *   openssl rand -hex 32
 *
 * Stored format (single base64 string): iv(12) || authTag(16) || ciphertext.
 */
@Injectable()
export class CryptoService {
  private static readonly IV_BYTES = 12
  private static readonly TAG_BYTES = 16

  /** Resolves and validates the key lazily so the app can boot without it set. */
  private get key(): Buffer {
    const hex = process.env.ENCRYPTION_KEY
    if (!hex) {
      throw new InternalServerErrorException('ENCRYPTION_KEY is not configured — cannot encrypt/decrypt secrets')
    }
    const key = Buffer.from(hex, 'hex')
    if (key.length !== 32) {
      throw new InternalServerErrorException('ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
    }
    return key
  }

  /** Whether an encryption key is configured (used to fail fast before storing secrets). */
  get isConfigured(): boolean {
    const hex = process.env.ENCRYPTION_KEY
    return !!hex && Buffer.from(hex, 'hex').length === 32
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(CryptoService.IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64')
    const iv = buf.subarray(0, CryptoService.IV_BYTES)
    const authTag = buf.subarray(CryptoService.IV_BYTES, CryptoService.IV_BYTES + CryptoService.TAG_BYTES)
    const ciphertext = buf.subarray(CryptoService.IV_BYTES + CryptoService.TAG_BYTES)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }
}

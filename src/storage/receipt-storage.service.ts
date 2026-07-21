import { Injectable, Logger } from '@nestjs/common'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import { del, put } from '@vercel/blob'

export interface StoredReceipt {
  /** Backend key/pathname used to fetch or delete the object later. */
  key: string
  /** Fully-qualified URL of the stored object (server-side only). */
  url: string
}

/**
 * Stores and serves transfer-receipt images. The backend is chosen by `RECEIPT_STORAGE_DRIVER`:
 *   - `local` (default) → files on local disk under `./storage/receipts`. Simple for testing,
 *     but NOT durable on ephemeral hosts (Railway/Render wipe the disk on redeploy).
 *   - `blob` → Vercel Blob (durable object storage), requires `BLOB_READ_WRITE_TOKEN`. If the
 *     token is missing, it falls back to local disk with a warning.
 * The Blob path is fully implemented and ready; local is the deliberate default for now.
 * Receipts are small (a phone screenshot) and short-lived (deleted once the booking resolves).
 */
@Injectable()
export class ReceiptStorageService {
  private readonly logger = new Logger(ReceiptStorageService.name)
  /** Where local-disk files live. */
  private readonly localDir = resolve(process.cwd(), 'storage', 'receipts')

  private get blobToken(): string | undefined {
    return process.env.BLOB_READ_WRITE_TOKEN
  }

  /** Selected backend, defaulting to local-disk storage. */
  private get driver(): 'local' | 'blob' {
    return process.env.RECEIPT_STORAGE_DRIVER === 'blob' ? 'blob' : 'local'
  }

  /** True only when Blob is explicitly selected AND a token is present; else local disk is used. */
  get usesBlob(): boolean {
    if (this.driver !== 'blob') return false
    if (!this.blobToken) {
      this.logger.warn('RECEIPT_STORAGE_DRIVER=blob but BLOB_READ_WRITE_TOKEN is unset — using local disk')
      return false
    }
    return true
  }

  /**
   * Persists the receipt bytes and returns the key + URL to store on the PaymentReceipt row.
   * `key` is a unique pathname (e.g. `receipts/<bookingId>/<cuid>.jpg`).
   */
  async upload(key: string, bytes: Buffer, mimeType: string): Promise<StoredReceipt> {
    if (this.usesBlob) {
      const blob = await put(key, bytes, {
        access: 'public',
        contentType: mimeType,
        token: this.blobToken,
        // The pathname already carries a cuid, so it's unguessable — no extra suffix needed.
        addRandomSuffix: false,
      })
      return { key: blob.pathname, url: blob.url }
    }

    // Local disk: the "url" is a file:// path the service reads back itself.
    const filePath = join(this.localDir, key)
    await fs.mkdir(join(filePath, '..'), { recursive: true })
    await fs.writeFile(filePath, bytes)
    this.logger.log(`Stored receipt on local disk at ${filePath}`)
    return { key, url: `file://${filePath}` }
  }

  /** Reads the receipt bytes back for serving through the authenticated API endpoint. */
  async getBytes(receipt: { url: string; storageKey: string }): Promise<Buffer> {
    if (this.usesBlob || receipt.url.startsWith('http')) {
      const res = await fetch(receipt.url)
      if (!res.ok) throw new Error(`Failed to fetch receipt blob (${res.status})`)
      return Buffer.from(await res.arrayBuffer())
    }
    const filePath = join(this.localDir, receipt.storageKey)
    return fs.readFile(filePath)
  }

  /** Best-effort delete (called when the booking is resolved). Never throws to the caller. */
  async delete(receipt: { url: string; storageKey: string }): Promise<void> {
    try {
      if (this.usesBlob || receipt.url.startsWith('http')) {
        await del(receipt.url, { token: this.blobToken })
        return
      }
      await fs.unlink(join(this.localDir, receipt.storageKey)).catch(() => {})
    } catch (err) {
      this.logger.error(`Failed to delete receipt ${receipt.storageKey}`, err)
    }
  }
}

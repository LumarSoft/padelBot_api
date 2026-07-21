import { Injectable, Logger } from '@nestjs/common'

export interface DownloadedMedia {
  bytes: Buffer
  mimeType: string
}

/**
 * Downloads inbound WhatsApp media (transfer-receipt photos). Kept in its own dependency-free
 * module so the bot can use it without creating a BotModule ⇄ WhatsAppModule import cycle
 * (WhatsAppModule already imports BotModule). Retrieving Meta media is a two-step dance: resolve
 * the media id to a short-lived signed URL, then GET that URL — both with the Graph token.
 */
@Injectable()
export class WhatsAppMediaService {
  private readonly logger = new Logger(WhatsAppMediaService.name)

  private get apiVersion(): string {
    return process.env.WHATSAPP_API_VERSION ?? 'v21.0'
  }
  private get token(): string {
    return process.env.WHATSAPP_TOKEN ?? process.env.META_ACCESS_TOKEN ?? ''
  }

  /** Resolves a Meta media id to its (short-lived) download URL and mime type. */
  async getMediaUrl(mediaId: string): Promise<{ url: string; mimeType: string } | null> {
    try {
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (!res.ok) {
        this.logger.error(`Graph media lookup failed (${res.status}) for media ${mediaId}`)
        return null
      }
      const data = (await res.json()) as { url?: string; mime_type?: string }
      if (!data.url) return null
      return { url: data.url, mimeType: data.mime_type ?? 'application/octet-stream' }
    } catch (err) {
      this.logger.error(`Failed to resolve media url for ${mediaId}`, err)
      return null
    }
  }

  /** Downloads media bytes from a resolved Graph media URL (requires the token). */
  async download(mediaId: string): Promise<DownloadedMedia | null> {
    const resolved = await this.getMediaUrl(mediaId)
    if (!resolved) return null
    try {
      const res = await fetch(resolved.url, { headers: { Authorization: `Bearer ${this.token}` } })
      if (!res.ok) {
        this.logger.error(`Graph media download failed (${res.status}) for media ${mediaId}`)
        return null
      }
      const bytes = Buffer.from(await res.arrayBuffer())
      const mimeType = res.headers.get('content-type') ?? resolved.mimeType
      return { bytes, mimeType }
    } catch (err) {
      this.logger.error(`Failed to download media ${mediaId}`, err)
      return null
    }
  }
}

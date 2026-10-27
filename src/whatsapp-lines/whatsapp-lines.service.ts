import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { randomInt } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../common/crypto/crypto.service'
import { CreateWhatsAppLineDto } from './dto/create-whatsapp-line.dto'
import { EmbeddedSignupDto } from './dto/embedded-signup.dto'
import {
  MetaGraphError,
  exchangeCode,
  fetchPhoneNumber,
  listWabaNumbers,
  registerNumber,
  subscribeApp,
  syncBusinessAppData,
} from './lib/meta-graph'

const lineSelect = {
  id: true,
  phoneNumberId: true,
  displayPhone: true,
  isActive: true,
  coexistence: true,
  createdAt: true,
} as const

/** How long a resolved per-line token stays cached (a reconnect replaces it). */
const TOKEN_CACHE_MS = 5 * 60 * 1000

@Injectable()
export class WhatsAppLinesService {
  private readonly logger = new Logger(WhatsAppLinesService.name)
  private readonly tokenCache = new Map<string, { token: string | null; at: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  findAll(clubId: string) {
    return this.prisma.whatsAppLine.findMany({
      where: { clubId },
      select: lineSelect,
      orderBy: { createdAt: 'asc' },
    })
  }

  async create(clubId: string, dto: CreateWhatsAppLineDto) {
    const existing = await this.prisma.whatsAppLine.findUnique({
      where: { phoneNumberId: dto.phoneNumberId },
    })
    if (existing) {
      throw new ConflictException(`Phone number ID ${dto.phoneNumberId} is already registered`)
    }

    return this.prisma.whatsAppLine.create({
      data: { phoneNumberId: dto.phoneNumberId, displayPhone: dto.displayPhone, clubId },
      select: lineSelect,
    })
  }

  async remove(clubId: string, id: string) {
    const line = await this.prisma.whatsAppLine.findFirst({ where: { id, clubId } })
    if (!line) throw new NotFoundException(`WhatsApp line ${id} not found`)
    await this.prisma.whatsAppLine.delete({ where: { id } })
    this.tokenCache.delete(line.phoneNumberId)
  }

  /**
   * The app id + Facebook Login for Business configuration id the panel passes to FB.login.
   * Both are public identifiers (not secrets); `enabled` is false until the server has the
   * app secret too, so the panel never opens a popup the API can't finish.
   */
  embeddedSignupConfig(): { enabled: boolean; appId: string | null; configId: string | null; apiVersion: string } {
    const appId = process.env.WHATSAPP_APP_ID ?? null
    const configId = process.env.WHATSAPP_ES_CONFIG_ID ?? null
    const hasSecret = Boolean(process.env.WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET)
    return {
      enabled: Boolean(appId && configId && hasSecret),
      appId,
      configId,
      apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
    }
  }

  /**
   * Finishes Meta's Embedded Signup for the caller's club: exchanges the popup's code for the
   * WABA's business token, subscribes our app to the WABA's webhooks, registers the number
   * (Cloud-API-only) or syncs contacts + history (coexistence), and stores the line so the
   * bot starts answering it. Re-running it for the same number (a reconnect) updates the line.
   */
  async connectEmbeddedSignup(clubId: string, dto: EmbeddedSignupDto) {
    const appId = process.env.WHATSAPP_APP_ID
    const appSecret = process.env.WHATSAPP_APP_SECRET ?? process.env.META_APP_SECRET
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException('La conexión con WhatsApp no está configurada en el servidor')
    }

    const coexistence = dto.coexistence === true
    try {
      // The code is single-use with a 30s TTL: exchange it before anything else.
      const token = await exchangeCode(dto.code, appId, appSecret)
      const phoneNumberId = dto.phoneNumberId ?? (await this.singleNumberOf(dto.wabaId, token))
      await this.assertNumberFree(phoneNumberId, clubId)
      const info = await fetchPhoneNumber(phoneNumberId, token)
      if (coexistence && info.is_on_biz_app === false) {
        throw new MetaGraphError('check_number', `number ${phoneNumberId} is not on the WhatsApp Business app`)
      }

      await subscribeApp(dto.wabaId, token)
      if (coexistence) {
        // Contacts first, then history (Meta's order); both only within 24h of onboarding.
        await syncBusinessAppData(phoneNumberId, token, 'smb_app_state_sync')
        await syncBusinessAppData(phoneNumberId, token, 'history')
      } else if (info.status !== 'CONNECTED') {
        // Only a number that isn't live yet gets registered: re-registering a live one would
        // reset its two-step PIN under whoever else uses it. The PIN can be reset any time
        // from WhatsApp Manager, so we don't keep it.
        await registerNumber(phoneNumberId, token, String(randomInt(100000, 1000000)))
      }

      const data = {
        clubId,
        wabaId: dto.wabaId,
        coexistence,
        displayPhone: info.display_phone_number ?? phoneNumberId,
        accessToken: this.crypto.isConfigured ? this.crypto.encrypt(token) : null,
        isActive: true,
      }
      const line = await this.prisma.whatsAppLine.upsert({
        where: { phoneNumberId },
        create: { phoneNumberId, ...data },
        update: data,
        select: lineSelect,
      })
      this.tokenCache.delete(phoneNumberId)
      this.logger.log(
        `WhatsApp line ${line.displayPhone} connected to club ${clubId} via Embedded Signup` +
          ` (waba=${dto.wabaId}, coexistence=${coexistence}, on_biz_app=${info.is_on_biz_app ?? 'n/a'})`,
      )
      return line
    } catch (err) {
      if (err instanceof MetaGraphError) {
        this.logger.error(`Embedded Signup failed for club ${clubId} at ${err.step}: ${err.detail}`)
        throw new BadGatewayException(`Meta rechazó la conexión (${err.step}). Probá de nuevo en unos minutos.`)
      }
      throw err
    }
  }

  /**
   * Coexistence finishes only report the WABA. A WABA fresh out of Embedded Signup has one
   * number; with several we refuse to guess rather than touch someone else's number.
   */
  private async singleNumberOf(wabaId: string, token: string): Promise<string> {
    const numbers = await listWabaNumbers(wabaId, token)
    if (numbers.length !== 1) {
      throw new MetaGraphError('list_numbers', `WABA ${wabaId} has ${numbers.length} numbers, expected exactly 1`)
    }
    return numbers[0]
  }

  /** A number can serve a single club: refuse to move it silently from another tenant. */
  private async assertNumberFree(phoneNumberId: string, clubId: string): Promise<void> {
    const taken = await this.prisma.whatsAppLine.findUnique({ where: { phoneNumberId }, select: { clubId: true } })
    if (taken && taken.clubId !== clubId) {
      throw new ConflictException('Ese número de WhatsApp ya está conectado a otro club')
    }
  }

  /**
   * The business token Meta issued for this number in Embedded Signup, or null when the line
   * has none (manual line → the sender falls back to the global WHATSAPP_TOKEN). Cached
   * briefly because it runs on every outbound message.
   */
  async findAccessToken(phoneNumberId: string): Promise<string | null> {
    const cached = this.tokenCache.get(phoneNumberId)
    if (cached && Date.now() - cached.at < TOKEN_CACHE_MS) return cached.token

    let token: string | null = null
    try {
      const line = await this.prisma.whatsAppLine.findUnique({
        where: { phoneNumberId },
        select: { accessToken: true },
      })
      token = line?.accessToken ? this.crypto.decrypt(line.accessToken) : null
    } catch (err) {
      this.logger.error(`Could not read the stored token of line ${phoneNumberId}; using the global one`, err)
    }
    this.tokenCache.set(phoneNumberId, { token, at: Date.now() })
    return token
  }

  /**
   * Resolves the active WhatsApp line to send *from* on behalf of a club (the reverse of
   * `resolveClub`). Called by cross-cutting senders (e.g. booking reminders) that only have
   * a `clubId` and need a `phoneNumberId` to call the Graph API with.
   */
  async findActiveForClub(clubId: string): Promise<{ phoneNumberId: string } | null> {
    return this.prisma.whatsAppLine.findFirst({
      where: { clubId, isActive: true },
      select: { phoneNumberId: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  /**
   * Resolves the club that owns a given Meta phone_number_id.
   * Called by the bot on every incoming webhook message.
   */
  async resolveClub(phoneNumberId: string): Promise<{ clubId: string }> {
    const line = await this.prisma.whatsAppLine.findUnique({
      where: { phoneNumberId },
      select: { clubId: true, isActive: true },
    })
    if (!line || !line.isActive) {
      throw new NotFoundException(`No active club found for phone number ID ${phoneNumberId}`)
    }
    return { clubId: line.clubId }
  }
}

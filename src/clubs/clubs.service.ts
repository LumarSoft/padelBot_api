import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../common/crypto/crypto.service'
import { MercadoPagoService } from '../mercadopago/mercadopago.service'
import { UpdateTransferConfigDto } from './dto/update-transfer-config.dto'
import { UpdateClubProfileDto } from './dto/update-club-profile.dto'
import { DepositMode, PaymentVerificationMode, PlayerRescheduleMode } from 'generated/prisma/client'
import { SubscriptionState, subscriptionSelect, subscriptionState } from './lib/subscription'

export interface TransferConfig {
  transferAlias: string | null
  transferHolder: string | null
  depositMode: DepositMode
  depositPercent: number
  requireDniMatch: boolean
  paymentVerificationMode: PaymentVerificationMode
  cancellationWindowHours: number
  /** What a player may do from WhatsApp when they can't make it (the bot moves, never cancels). */
  playerReschedule: PlayerRescheduleMode
  playerRescheduleCutoffHours: number | null
  maxPlayerReschedules: number
}

export interface ClubProfile {
  name: string
  slug: string
  botWelcomeExtra: string | null
  locationInfo: string | null
}

export interface MercadoPagoStatus {
  /** Whether the club has connected its own MercadoPago account via OAuth. */
  connected: boolean
  connectedAt: Date | null
  /** MercadoPago user id of the connected account (for display / support). */
  mpUserId: string | null
}

/** Refresh the access token when it's within this margin of expiring. */
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000
/** A connect `state` is only valid for this long after it's issued. */
const STATE_TTL_MS = 10 * 60 * 1000

/**
 * Where the owner kicked off the MercadoPago connect flow, so the OAuth callback can send
 * them back to it. A closed set (never a caller-supplied URL) — the callback is public, so
 * echoing an arbitrary destination back into `res.redirect` would be an open redirect.
 */
export type MercadoPagoConnectOrigin = 'configuracion' | 'setup'

/** Panel path each origin resolves to on the way back. */
export const CONNECT_ORIGIN_PATHS: Record<MercadoPagoConnectOrigin, string> = {
  configuracion: '/panel/configuracion?tab=pagos',
  setup: '/setup?step=pagos',
}

export function isConnectOrigin(value: unknown): value is MercadoPagoConnectOrigin {
  return value === 'configuracion' || value === 'setup'
}

@Injectable()
export class ClubsService {
  private readonly logger = new Logger(ClubsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mp: MercadoPagoService,
  ) {}

  /** Effective subscription state for the panel's banner (soft guard, never blocks the panel). */
  async getSubscriptionState(clubId: string): Promise<SubscriptionState> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: subscriptionSelect,
    })
    if (!club) throw new NotFoundException(`Club ${clubId} not found`)
    return subscriptionState(club)
  }

  async getProfile(clubId: string): Promise<ClubProfile> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { name: true, slug: true, botWelcomeExtra: true, locationInfo: true },
    })
    if (!club) throw new NotFoundException(`Club ${clubId} not found`)
    return club
  }

  async updateProfile(clubId: string, dto: UpdateClubProfileDto): Promise<ClubProfile> {
    await this.prisma.club.update({
      where: { id: clubId },
      data: {
        name: dto.name.trim(),
        ...(dto.botWelcomeExtra !== undefined ? { botWelcomeExtra: dto.botWelcomeExtra.trim() || null } : {}),
        ...(dto.locationInfo !== undefined ? { locationInfo: dto.locationInfo.trim() || null } : {}),
      },
    })
    return this.getProfile(clubId)
  }

  async getTransferConfig(clubId: string): Promise<TransferConfig> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: {
        transferAlias: true,
        transferHolder: true,
        depositMode: true,
        depositPercent: true,
        cancellationWindowHours: true,
        playerReschedule: true,
        playerRescheduleCutoffHours: true,
        maxPlayerReschedules: true,
        requireDniMatch: true,
        paymentVerificationMode: true,
      },
    })
    if (!club) throw new NotFoundException(`Club ${clubId} not found`)
    return club
  }

  async updateTransferConfig(clubId: string, dto: UpdateTransferConfigDto): Promise<TransferConfig> {
    await this.prisma.club.update({
      where: { id: clubId },
      data: {
        ...(dto.transferAlias !== undefined ? { transferAlias: dto.transferAlias.trim() || null } : {}),
        ...(dto.transferHolder !== undefined ? { transferHolder: dto.transferHolder.trim() || null } : {}),
        ...(dto.depositMode !== undefined ? { depositMode: dto.depositMode } : {}),
        ...(dto.depositPercent !== undefined ? { depositPercent: dto.depositPercent } : {}),
        ...(dto.cancellationWindowHours !== undefined ? { cancellationWindowHours: dto.cancellationWindowHours } : {}),
        ...(dto.playerReschedule !== undefined ? { playerReschedule: dto.playerReschedule } : {}),
        // 0 from the panel means "no cutoff" — stored as null.
        ...(dto.playerRescheduleCutoffHours !== undefined
          ? { playerRescheduleCutoffHours: dto.playerRescheduleCutoffHours || null }
          : {}),
        ...(dto.maxPlayerReschedules !== undefined ? { maxPlayerReschedules: dto.maxPlayerReschedules } : {}),
        ...(dto.requireDniMatch !== undefined ? { requireDniMatch: dto.requireDniMatch } : {}),
        ...(dto.paymentVerificationMode !== undefined ? { paymentVerificationMode: dto.paymentVerificationMode } : {}),
      },
    })
    return this.getTransferConfig(clubId)
  }

  // ── MercadoPago Connect (OAuth) ──────────────────────────────────────────────

  async getMercadoPagoStatus(clubId: string): Promise<MercadoPagoStatus> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { mpAccessToken: true, mpConnectedAt: true, mpUserId: true },
    })
    if (!club) throw new NotFoundException(`Club ${clubId} not found`)
    return {
      connected: !!club.mpAccessToken,
      connectedAt: club.mpConnectedAt,
      mpUserId: club.mpUserId,
    }
  }

  /**
   * Builds the MercadoPago authorization URL the owner is redirected to. The `state`
   * is an encrypted, time-limited token carrying the clubId, so the callback can't be
   * forged or replayed to attach someone else's MP account to this club (CSRF guard).
   *
   * `origin` says which screen the owner started from, so the callback can drop them back
   * there (the setup wizard must not lose them to Configuración mid-flow). It travels
   * INSIDE the encrypted state and is resolved against a fixed whitelist on the way out —
   * never a caller-supplied URL, which would be an open redirect.
   */
  buildConnectUrl(clubId: string, origin: MercadoPagoConnectOrigin = 'configuracion'): string {
    if (!this.mp.isOAuthConfigured) {
      throw new BadRequestException('MercadoPago Connect is not configured on the server')
    }
    if (!this.crypto.isConfigured) {
      throw new BadRequestException('ENCRYPTION_KEY is not configured — cannot store MercadoPago tokens')
    }
    const state = this.crypto.encrypt(JSON.stringify({ clubId, origin, ts: Date.now() }))
    return this.mp.getAuthorizationUrl(state)
  }

  /**
   * OAuth callback: validates the signed `state`, exchanges the `code` for the club's
   * own tokens, and stores them encrypted. Returns the screen the owner came from so the
   * controller can redirect them back to it.
   */
  async handleConnectCallback(code: string, state: string): Promise<MercadoPagoConnectOrigin> {
    const { clubId, origin } = this.verifyState(state)

    const tokens = await this.mp.exchangeCodeForToken(code)

    await this.prisma.club.update({
      where: { id: clubId },
      data: {
        mpAccessToken: this.crypto.encrypt(tokens.accessToken),
        mpRefreshToken: this.crypto.encrypt(tokens.refreshToken),
        mpUserId: tokens.userId,
        mpTokenExpiresAt: tokens.expiresAt,
        mpConnectedAt: new Date(),
      },
    })
    this.logger.log(`Club ${clubId} connected MercadoPago account ${tokens.userId}`)
    return origin
  }

  /** Disconnects the club's MercadoPago account (clears stored tokens). */
  async disconnectMercadoPago(clubId: string): Promise<void> {
    await this.prisma.club.update({
      where: { id: clubId },
      data: {
        mpAccessToken: null,
        mpRefreshToken: null,
        mpUserId: null,
        mpTokenExpiresAt: null,
        mpConnectedAt: null,
      },
    })
  }

  /**
   * Returns a usable (decrypted, non-expired) access token for the club, refreshing it
   * if it's about to expire. Returns null when the club hasn't connected MercadoPago
   * (the caller then falls back to the shared env token). Never throws — a club with a
   * broken token must not break the poller for every other club.
   */
  async getValidMpAccessToken(clubId: string): Promise<string | null> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { mpAccessToken: true, mpRefreshToken: true, mpTokenExpiresAt: true },
    })
    if (!club?.mpAccessToken) return null

    const expiresSoon = !club.mpTokenExpiresAt || club.mpTokenExpiresAt.getTime() - Date.now() < TOKEN_REFRESH_MARGIN_MS

    if (expiresSoon && club.mpRefreshToken) {
      try {
        const refreshToken = this.crypto.decrypt(club.mpRefreshToken)
        const tokens = await this.mp.refreshAccessToken(refreshToken)
        await this.prisma.club.update({
          where: { id: clubId },
          data: {
            mpAccessToken: this.crypto.encrypt(tokens.accessToken),
            mpRefreshToken: this.crypto.encrypt(tokens.refreshToken),
            mpTokenExpiresAt: tokens.expiresAt,
          },
        })
        return tokens.accessToken
      } catch (err) {
        this.logger.error(`Failed to refresh MercadoPago token for club ${clubId}`, err)
        // Fall through and try the current token — it may still have a few minutes left.
      }
    }

    try {
      return this.crypto.decrypt(club.mpAccessToken)
    } catch (err) {
      this.logger.error(`Failed to decrypt MercadoPago token for club ${clubId}`, err)
      return null
    }
  }

  /** Decrypts + validates a connect `state`, returning the clubId or throwing. */
  private verifyState(state: string): { clubId: string; origin: MercadoPagoConnectOrigin } {
    let parsed: { clubId?: string; origin?: string; ts?: number }
    try {
      parsed = JSON.parse(this.crypto.decrypt(state))
    } catch {
      throw new BadRequestException('Invalid MercadoPago connect state')
    }
    if (!parsed.clubId || !parsed.ts || Date.now() - parsed.ts > STATE_TTL_MS) {
      throw new BadRequestException('Expired or invalid MercadoPago connect state')
    }
    return {
      clubId: parsed.clubId,
      // Anything unrecognized falls back to Configuración — never trust it as a URL.
      origin: isConnectOrigin(parsed.origin) ? parsed.origin : 'configuracion',
    }
  }
}

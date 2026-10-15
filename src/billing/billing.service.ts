import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { CreditPackStatus, SubscriptionStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { notifyOps } from '../common/ops-alert'
import { todayKey } from '../availability/lib/datetime'
import { subscriptionSelect, subscriptionState } from '../clubs/lib/subscription'
import { ActivePack, CreditsService } from '../plans/credits.service'
import { creditPercent, monthKeyOf } from '../plans/lib/ai-credits'
import { planDefinition, planName } from '../plans/lib/plans'
import { BillingMercadoPagoService, BillingPayment } from './billing-mercadopago.service'
import {
  CREDIT_PACK_VALIDITY_MONTHS,
  CREDIT_PACKS,
  CreditPack,
  creditPack,
  packExpiry,
  packReference,
  purchaseIdFromReference,
} from './lib/credit-packs'

/** MercadoPago statuses after which a pack will never be paid. */
const FAILED_STATUSES = new Set(['rejected', 'cancelled', 'refunded', 'charged_back'])

export interface PurchaseRow {
  id: string
  packKey: string
  credits: number
  priceCents: number
  status: CreditPackStatus
  createdAt: Date
  approvedAt: Date | null
  expiresAt: Date | null
}

/** Everything the owner's "Facturación" page shows. */
export interface BillingOverview {
  plan: { key: string; name: string; known: boolean }
  subscription: {
    status: SubscriptionStatus
    severity: 'ok' | 'trial' | 'warning' | 'blocked'
    /** End of the paid period (or of the trial); null when there's no date. */
    renewsAt: Date | null
  }
  credits: {
    month: string
    used: number
    /** The plan's credits for the month; null for an unknown plan. */
    included: number | null
    fromPacks: number
    extraBalance: number
    available: number | null
    percent: number | null
  }
  /** Packs still usable, soonest expiry first (the order they're spent in). */
  packs: ActivePack[]
  purchases: PurchaseRow[]
  catalog: readonly CreditPack[]
  validityMonths: number
  /** Packs need an active plan (trial included); false once the subscription is blocked. */
  canBuy: boolean
}

const purchaseSelect = {
  id: true,
  packKey: true,
  credits: true,
  priceCents: true,
  status: true,
  createdAt: true,
  approvedAt: true,
  expiresAt: true,
} as const

/**
 * What a club pays Lumarsoft beyond its plan: credit packs, bought with MercadoPago Checkout Pro
 * into Lumarsoft's account. A pack is credited only when MercadoPago says the payment is
 * approved — from the signed webhook, or from the owner's return to the panel, both checked
 * against MercadoPago's own payment record and both idempotent.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    private readonly mp: BillingMercadoPagoService,
  ) {}

  async overview(clubId: string): Promise<BillingOverview> {
    const today = todayKey()
    const [club, month, packs, purchases] = await Promise.all([
      this.prisma.club.findUnique({ where: { id: clubId }, select: subscriptionSelect }),
      this.credits.monthCredits(clubId, today),
      this.credits.activePacks(clubId),
      this.prisma.creditPackPurchase.findMany({
        // A checkout the owner abandoned isn't history; it stays out until MercadoPago settles it.
        where: { clubId, status: { not: CreditPackStatus.PENDING } },
        select: purchaseSelect,
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])
    if (!club) throw new NotFoundException('Club no encontrado')

    const subscription = subscriptionState(club)
    const plan = planDefinition(club.plan)
    const included = plan?.aiCredits ?? null
    const extraBalance = packs.reduce((sum, pack) => sum + pack.remaining, 0)
    return {
      plan: { key: club.plan, name: planName(club.plan), known: plan !== null },
      subscription: {
        status: club.subscriptionStatus,
        severity: subscription.severity,
        renewsAt:
          club.subscriptionStatus === SubscriptionStatus.TRIAL
            ? club.trialEndsAt
            : club.subscriptionStatus === SubscriptionStatus.CANCELLED
              ? null
              : club.currentPeriodEnd,
      },
      credits: {
        month: monthKeyOf(today),
        used: month.used,
        included,
        fromPacks: month.fromPacks,
        extraBalance,
        available: included === null ? null : included + month.fromPacks + extraBalance,
        percent: creditPercent(month.used, included),
      },
      packs,
      purchases,
      catalog: CREDIT_PACKS,
      validityMonths: CREDIT_PACK_VALIDITY_MONTHS,
      canBuy: subscription.severity !== 'blocked',
    }
  }

  /** Starts a pack purchase: a PENDING row and the MercadoPago checkout the owner is sent to. */
  async buyPack(clubId: string, userId: number, packKey: string): Promise<{ purchaseId: string; checkoutUrl: string }> {
    const pack = creditPack(packKey)
    if (!pack) throw new BadRequestException('Ese paquete no existe')

    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: subscriptionSelect })
    if (!club) throw new NotFoundException('Club no encontrado')
    if (subscriptionState(club).severity === 'blocked') {
      throw new ForbiddenException('Para comprar créditos tu plan tiene que estar activo. Escribinos y lo vemos.')
    }
    if (!this.mp.isConfigured) {
      throw new ServiceUnavailableException(
        'La compra de créditos todavía no está habilitada. Escribinos y te los cargamos.',
      )
    }

    const purchase = await this.prisma.creditPackPurchase.create({
      data: { clubId, packKey: pack.key, credits: pack.credits, priceCents: pack.priceCents, createdByUserId: userId },
      select: { id: true },
    })
    const panel = (process.env.ADMIN_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '')
    try {
      const preference = await this.mp.createPackPreference({
        title: `${pack.credits.toLocaleString('es-AR')} créditos de IA — GTP`,
        priceCents: pack.priceCents,
        externalReference: packReference(purchase.id),
        returnUrl: `${panel}/panel/facturacion?compra=${purchase.id}`,
      })
      await this.prisma.creditPackPurchase.update({
        where: { id: purchase.id },
        data: { mpPreferenceId: preference.id },
      })
      return { purchaseId: purchase.id, checkoutUrl: preference.checkoutUrl }
    } catch (err) {
      this.logger.error(`Could not open the checkout of purchase ${purchase.id}`, err)
      throw new ServiceUnavailableException('No pudimos abrir MercadoPago. Probá de nuevo en un rato.')
    }
  }

  /**
   * The owner came back from MercadoPago with a payment id. Checked against MercadoPago (never
   * trusted from the URL) and applied exactly like the webhook would — whichever arrives first.
   */
  async confirmReturn(clubId: string, purchaseId: string, paymentId: string): Promise<PurchaseRow> {
    const purchase = await this.prisma.creditPackPurchase.findFirst({
      where: { id: purchaseId, clubId },
      select: { id: true },
    })
    if (!purchase) throw new NotFoundException('Compra no encontrada')

    let payment: BillingPayment
    try {
      payment = await this.mp.getPayment(paymentId)
    } catch {
      throw new ServiceUnavailableException('No pudimos consultar el pago en MercadoPago. Probá de nuevo en un rato.')
    }
    if (purchaseIdFromReference(payment.externalReference) !== purchase.id) {
      throw new BadRequestException('Ese pago no corresponde a esta compra')
    }
    await this.applyPayment(payment)
    return this.prisma.creditPackPurchase.findUniqueOrThrow({ where: { id: purchase.id }, select: purchaseSelect })
  }

  /**
   * MercadoPago's notification for a payment of Lumarsoft's account. A bad signature is refused;
   * anything that isn't a pack payment is ignored. Throws only when MercadoPago can't be reached,
   * so MercadoPago retries the notification later.
   */
  async handleWebhook(
    dataId: string,
    type: string | undefined,
    xRequestId?: string,
    xSignature?: string,
  ): Promise<void> {
    if (!dataId || (type && type !== 'payment')) return
    if (!this.mp.verifySignature(dataId, xRequestId, xSignature)) {
      throw new ForbiddenException('Invalid webhook signature')
    }
    const payment = await this.mp.getPayment(dataId)
    await this.applyPayment(payment)
  }

  /** Credits (or fails) the pack behind a MercadoPago payment. Safe to run any number of times. */
  async applyPayment(payment: BillingPayment): Promise<void> {
    const purchaseId = purchaseIdFromReference(payment.externalReference)
    if (!purchaseId) return
    const purchase = await this.prisma.creditPackPurchase.findUnique({
      where: { id: purchaseId },
      select: {
        id: true,
        status: true,
        credits: true,
        priceCents: true,
        mpPaymentId: true,
        club: { select: { name: true } },
      },
    })
    if (!purchase) {
      this.logger.warn(`MercadoPago payment ${payment.id} points to unknown purchase ${purchaseId}`)
      return
    }

    if (payment.status === 'approved') {
      if (payment.amountCents < purchase.priceCents) {
        this.logger.error(`Payment ${payment.id} paid ${payment.amountCents} for purchase ${purchase.id}`)
        await notifyOps(
          `⚠️ El pago ${payment.id} de *${purchase.club.name}* no cubre el paquete (${purchase.priceCents / 100}): no lo acreditamos.`,
        )
        return
      }
      if (purchase.status === CreditPackStatus.APPROVED) {
        if (purchase.mpPaymentId !== payment.id) {
          await notifyOps(
            `⚠️ *${purchase.club.name}* pagó dos veces la misma compra de créditos (${payment.id}). Revisalo.`,
          )
        }
        return
      }
      const approvedAt = new Date()
      const { count } = await this.prisma.creditPackPurchase.updateMany({
        where: { id: purchase.id, status: { not: CreditPackStatus.APPROVED } },
        data: {
          status: CreditPackStatus.APPROVED,
          mpPaymentId: payment.id,
          approvedAt,
          expiresAt: packExpiry(approvedAt),
        },
      })
      if (count === 1) {
        this.logger.log(`Credit pack ${purchase.id} approved (payment ${payment.id})`)
        await notifyOps(
          `💳 *${purchase.club.name}* compró ${purchase.credits.toLocaleString('es-AR')} créditos ` +
            `($${(purchase.priceCents / 100).toLocaleString('es-AR')}).`,
        )
      }
      return
    }

    if (FAILED_STATUSES.has(payment.status)) {
      await this.prisma.creditPackPurchase.updateMany({
        where: { id: purchase.id, status: CreditPackStatus.PENDING },
        data: { status: CreditPackStatus.REJECTED },
      })
    }
    // pending / in_process: MercadoPago will notify again when it settles.
  }
}

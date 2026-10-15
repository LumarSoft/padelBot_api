import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { BillingService } from './billing.service'
import { BuyCreditPackDto } from './dto/buy-credit-pack.dto'
import { ConfirmCreditPackDto } from './dto/confirm-credit-pack.dto'

/** The owner's "Facturación": plan, credits, credit packs. Owner-only — it's money. */
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    this.assertOwner(user)
    return this.billingService.overview(user.clubId)
  }

  /** Starts a credit pack purchase; the panel sends the owner to `checkoutUrl`. */
  @Post('credit-packs')
  buyPack(@CurrentUser() user: AuthenticatedUser, @Body() dto: BuyCreditPackDto) {
    this.assertOwner(user)
    return this.billingService.buyPack(user.clubId, parseInt(user.id, 10), dto.packKey)
  }

  /** The owner is back from MercadoPago: checks the payment and credits the pack if approved. */
  @Post('credit-packs/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ConfirmCreditPackDto) {
    this.assertOwner(user)
    return this.billingService.confirmReturn(user.clubId, id, dto.paymentId)
  }

  private assertOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño puede ver la facturación')
    }
  }
}

/**
 * MercadoPago's payment notifications for Lumarsoft's account (credit packs). Public, but every
 * call is checked against its `x-signature` and against MercadoPago's own payment record.
 */
@SkipThrottle()
@Controller('billing/mercadopago')
export class BillingWebhookController {
  constructor(private readonly billingService: BillingService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Query('data.id') queryDataId: string | undefined,
    @Query('type') queryType: string | undefined,
    @Body() body: { type?: string; data?: { id?: string | number } } | undefined,
  ): Promise<{ received: true }> {
    // MercadoPago signs the data.id of the query string; the body carries the same id.
    const dataId = String(queryDataId ?? body?.data?.id ?? '')
    await this.billingService.handleWebhook(dataId, body?.type ?? queryType, xRequestId, xSignature)
    return { received: true }
  }
}

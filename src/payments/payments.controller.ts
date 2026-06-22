import { Body, Controller, ForbiddenException, Headers, HttpCode, Post } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
import { PaymentsService } from './payments.service'
import { TransferNotificationDto } from './dto/transfer-notification.dto'

@Controller('webhooks')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * MercadoPago IPN webhook. MP calls this whenever a payment event occurs.
   * We verify the signature, fetch the real payment status from the MP API,
   * and confirm or cancel the associated booking accordingly.
   */
  @Post('mercadopago')
  @HttpCode(200)
  async handleMercadoPago(
    @Headers('x-signature') xSignature: string,
    @Headers('x-request-id') xRequestId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.paymentsService.handleWebhook(xSignature ?? '', xRequestId ?? '', body)
  }

  /**
   * Generic transfer-received webhook for an external notification source (e.g. a
   * PagaVoz-style bridge that reads the bank/MercadoPago app's "money received"
   * notification). Authenticated with a shared secret because a successful call
   * confirms a booking — it must never be publicly callable. Reconciliation is by
   * exact amount, so a forged amount still has to match a real pending booking.
   */
  @Post('transfer')
  @HttpCode(200)
  async handleTransfer(
    @Headers('x-bridge-secret') secret: string,
    @Body() dto: TransferNotificationDto,
  ): Promise<void> {
    this.assertBridgeSecret(secret)
    await this.paymentsService.handleTransferNotification(dto.amountCents, dto.reference)
  }

  /** Fail-closed shared-secret check (constant-time) for the transfer bridge. */
  private assertBridgeSecret(provided: string): void {
    const expected = process.env.TRANSFER_BRIDGE_SECRET
    if (!expected) throw new ForbiddenException('Transfer bridge is not configured')

    const a = Buffer.from(provided ?? '')
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid bridge secret')
    }
  }
}

import { Body, Controller, HttpCode, HttpStatus, Param, Patch, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { PaymentsService } from './payments.service'
import { AssignPaymentDto } from './dto/assign-payment.dto'

/**
 * Admin-facing actions on a booking's payment. Lives in PaymentsModule (not
 * BookingsModule) because confirming/rejecting also notifies the player via
 * WhatsApp, which PaymentsService already orchestrates.
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class PaymentsAdminController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Confirms a pending payment by hand. Optionally ASSIGNS a concrete detected
   * transfer (the casi-match queue): body carries the MP movement id + payer identity,
   * which is recorded on the booking and teaches future reconciliation.
   */
  @Patch(':id/confirm-payment')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignPaymentDto) {
    return this.paymentsService.confirmPaymentManually(user.clubId, id, {
      paymentRef: dto.paymentRef ?? null,
      payer: { cuit: dto.payerCuit ?? null, email: dto.payerEmail ?? null, mpUserId: dto.payerMpUserId ?? null },
    })
  }

  @Patch(':id/reject-payment')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.paymentsService.rejectPaymentManually(user.clubId, id)
  }
}

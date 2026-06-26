import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { PaymentsService } from './payments.service'
import { MoneyInDiagnosticsQueryDto } from './dto/money-in-diagnostics-query.dto'

/**
 * Read-only payment diagnostics for the production go/no-go check. Owner-only because
 * it reveals payer identity data from the club's MercadoPago account. Confirms nothing
 * and changes no booking state.
 */
@Controller('payments/diagnostics')
@UseGuards(JwtAuthGuard)
export class PaymentsDiagnosticsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /** Lists recent incoming transfers with the payer identity MercadoPago returns. */
  @Get('money-in')
  getMoneyIn(@CurrentUser() user: AuthenticatedUser, @Query() query: MoneyInDiagnosticsQueryDto) {
    this.assertOwner(user)
    return this.paymentsService.getMoneyInDiagnostics(user.clubId, query.minutes ?? 60)
  }

  private assertOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Only the club owner can read payment diagnostics')
    }
  }
}

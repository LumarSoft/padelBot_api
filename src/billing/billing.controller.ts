import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { BillingService } from './billing.service'

/** The owner's "Facturación": plan, subscription and credits. Owner-only — it's money. */
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño puede ver la facturación')
    }
    return this.billingService.overview(user.clubId)
  }
}

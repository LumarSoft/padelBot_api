import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { PlansService } from './plans.service'

@Controller('clubs/me/plan')
@UseGuards(JwtAuthGuard)
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  /** The club's plan: its limits and how much of them is used. Open to STAFF too. */
  @Get()
  getPlan(@CurrentUser() user: AuthenticatedUser) {
    return this.plansService.overview(user.clubId)
  }
}

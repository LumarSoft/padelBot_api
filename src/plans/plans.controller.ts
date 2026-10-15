import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
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
    return this.plansService.overview(user.clubId, parseInt(user.id, 10))
  }

  /** Closes the "te quedan pocos créditos" banner for this user (until next month, or 100%). */
  @Post('credits-notice/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismissCreditsNotice(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.plansService.dismissCreditsNotice(user.clubId, parseInt(user.id, 10))
  }
}

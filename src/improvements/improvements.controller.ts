import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { ClubImprovementSuggestion, ImprovementsService, PublishedImprovement } from './improvements.service'
import { CreateImprovementSuggestionDto } from './dto/create-improvement-suggestion.dto'

/**
 * "Mejoras" in the panel and the staff app: what Lumarsoft shipped or plans, and the club's
 * suggestions to us. Open to OWNER and STAFF alike.
 */
@Controller('improvements')
@UseGuards(JwtAuthGuard)
export class ImprovementsController {
  constructor(private readonly improvementsService: ImprovementsService) {}

  @Get()
  listPublished(): Promise<PublishedImprovement[]> {
    return this.improvementsService.listPublished()
  }

  @Get('suggestions')
  listSuggestions(@CurrentUser() user: AuthenticatedUser): Promise<ClubImprovementSuggestion[]> {
    return this.improvementsService.listForClub(user.clubId)
  }

  /** Each one pings our ops channel, so it's capped well above any honest use. */
  @Throttle({ default: { ttl: 60 * 60_000, limit: 10 } })
  @Post('suggestions')
  createSuggestion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateImprovementSuggestionDto,
  ): Promise<ClubImprovementSuggestion> {
    return this.improvementsService.create(user, dto)
  }
}

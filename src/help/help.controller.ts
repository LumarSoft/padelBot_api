import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { FirstDayStatus, HelpService, HouseRule, TeamMemberFirstDay } from './help.service'
import { UpdateHouseRulesDto } from './dto/update-house-rules.dto'
import { RecordSearchMissDto } from './dto/record-search-miss.dto'

/**
 * In-context help for the desk staff: the "Tu primer día" checklist, the club's house rules
 * and the log of help searches that found nothing. The help content itself (questions and the
 * "Mostrame" guides) lives in the panel.
 */
@Controller('help')
@UseGuards(JwtAuthGuard)
export class HelpController {
  constructor(private readonly helpService: HelpService) {}

  /** The caller's checklist, every task derived from what they actually did. */
  @Get('first-day')
  getFirstDay(@CurrentUser() user: AuthenticatedUser): Promise<FirstDayStatus> {
    return this.helpService.getFirstDay(parseInt(user.id, 10))
  }

  /** Closes the checklist card on the caller's Resumen. */
  @Post('first-day/dismiss')
  @HttpCode(HttpStatus.OK)
  dismissFirstDay(@CurrentUser() user: AuthenticatedUser): Promise<{ dismissedAt: Date }> {
    return this.helpService.dismissFirstDay(parseInt(user.id, 10))
  }

  /** Each employee's progress ("4 de 5"), for the owner's team table. */
  @Get('first-day/team')
  getTeamFirstDay(@CurrentUser() user: AuthenticatedUser): Promise<TeamMemberFirstDay[]> {
    this.assertOwner(user)
    return this.helpService.getTeamFirstDay(user.clubId)
  }

  @Get('house-rules')
  getHouseRules(@CurrentUser() user: AuthenticatedUser): Promise<HouseRule[]> {
    return this.helpService.getHouseRules(user.clubId)
  }

  /** Replaces the whole list. Owner-only: it's what the club tells its own staff. */
  @Patch('house-rules')
  updateHouseRules(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateHouseRulesDto): Promise<HouseRule[]> {
    this.assertOwner(user)
    return this.helpService.updateHouseRules(user.clubId, dto.entries)
  }

  /** A search in the "?" help that found nothing. The panel debounces; this caps the rest. */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('search-misses')
  @HttpCode(HttpStatus.OK)
  recordSearchMiss(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordSearchMissDto,
  ): Promise<{ recorded: boolean }> {
    return this.helpService.recordSearchMiss(user.clubId, dto.query)
  }

  private assertOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño del club puede hacer esto')
    }
  }
}

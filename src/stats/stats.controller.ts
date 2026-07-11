import { BadRequestException, Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { shiftDateKey, todayKey } from '../availability/lib/datetime'
import { StatsService } from './stats.service'
import { StatsReportsService } from './stats-reports.service'
import { OccupancyQueryDto } from './dto/occupancy-query.dto'
import { RevenueQueryDto } from './dto/revenue-query.dto'

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
    private readonly reports: StatsReportsService,
  ) {}

  @Get('overview')
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.statsService.getOverview(user.clubId)
  }

  /** Occupancy heatmap (weekday × band) over the last N full weeks. Owner-only. */
  @Get('occupancy')
  getOccupancy(@CurrentUser() user: AuthenticatedUser, @Query() query: OccupancyQueryDto) {
    this.assertOwner(user)
    return this.reports.getOccupancy(user.clubId, query.weeks)
  }

  /** Revenue per day (deposits collected + kiosk) in a date range. Owner-only. */
  @Get('revenue')
  getRevenue(@CurrentUser() user: AuthenticatedUser, @Query() query: RevenueQueryDto) {
    this.assertOwner(user)
    const to = query.to ?? todayKey()
    const from = query.from ?? shiftDateKey(to, -29)
    if (from > to) throw new BadRequestException('from must be ≤ to')
    return this.reports.getRevenue(user.clubId, from, to)
  }

  private assertOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño puede ver los reportes')
    }
  }
}

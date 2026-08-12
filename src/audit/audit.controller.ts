import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { shiftDateKey, todayKey } from '../availability/lib/datetime'
import { AuditQueryService } from './audit-query.service'
import { AuditReportsService } from './audit-reports.service'
import { QueryAuditDto } from './dto/query-audit.dto'
import { QueryAuditReportDto } from './dto/query-audit-report.dto'

/**
 * Read-only surface over the audit log. There is no write endpoint on purpose: entries are
 * produced by the services that perform the operations, never by a client.
 */
@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(
    private readonly query: AuditQueryService,
    private readonly reports: AuditReportsService,
  ) {}

  /** Filterable activity feed. */
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryAuditDto) {
    this.assertOwner(user)
    return this.query.findAll(user.clubId, query)
  }

  /**
   * Full timeline of one element, from its original state to the current one. This is the
   * view that demonstrates traceability over the booking.
   */
  @Get('entity/:entity/:id')
  findTimeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entity') entity: string,
    @Param('id') id: string,
  ) {
    this.assertOwner(user)
    return this.query.findTimeline(user.clubId, entity, id)
  }

  /** Sessions opened, closed and rejected. */
  @Get('sessions')
  findSessions(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryAuditDto) {
    this.assertOwner(user)
    return this.query.findSessions(user.clubId, query)
  }

  /** Aggregated report: events by action, by user and by day. */
  @Get('reports/summary')
  getSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryAuditReportDto) {
    this.assertOwner(user)
    const to = query.to ?? todayKey()
    const from = query.from ?? shiftDateKey(to, -29)
    if (from > to) throw new BadRequestException('from must be ≤ to')
    return this.reports.getSummary(user.clubId, from, to)
  }

  private assertOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño puede consultar la auditoría')
    }
  }
}

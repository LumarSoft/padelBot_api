import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ClubSignupRequest } from 'generated/prisma/client'
import { OpsAuthGuard } from './guards/ops-auth.guard'
import { CurrentAdmin } from './decorators/current-admin.decorator'
import { AuthenticatedOpsAdmin } from './types/ops-jwt'
import { OpsAuthService, OpsLoginResult } from './ops-auth.service'
import { OpsLeadsService, LeadsSummary } from './ops-leads.service'
import { OpsClubsService, OpsClubRow } from './ops-clubs.service'
import { OpsMetricsService, BusinessMetrics, BotMetrics } from './ops-metrics.service'
import { OpsHealthService, OpsHealth } from './ops-health.service'
import { SubscriptionState } from '../clubs/lib/subscription'
import { OpsLoginDto } from './dto/ops-login.dto'
import { UpdateLeadDto } from './dto/update-lead.dto'
import { ProvisionLeadDto } from './dto/provision-lead.dto'
import { UpdateSubscriptionDto } from './dto/update-subscription.dto'
import { ListLeadsQueryDto } from './dto/list-leads-query.dto'

/**
 * The Lumarsoft ops console (`/ops` in the panel). EVERY route here reads across tenants,
 * which is exactly what the rest of the API is built never to do — so the whole controller
 * sits behind OpsAuthGuard, which verifies against OPS_JWT_SECRET rather than the tenant
 * JWT_SECRET. A club's token is not merely rejected here; it doesn't validate.
 */
@Controller('ops')
export class OpsController {
  constructor(
    private readonly auth: OpsAuthService,
    private readonly leads: OpsLeadsService,
    private readonly clubs: OpsClubsService,
    private readonly metrics: OpsMetricsService,
    private readonly health: OpsHealthService,
  ) {}

  // ── Auth ──────────────────────────────────────────────────────────────────

  /** Unguarded by design (it mints the token). Rate-limited hard: one account sees everything. */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: OpsLoginDto): Promise<OpsLoginResult> {
    return this.auth.login(dto)
  }

  @Get('auth/me')
  @UseGuards(OpsAuthGuard)
  me(@CurrentAdmin() admin: AuthenticatedOpsAdmin): AuthenticatedOpsAdmin {
    return admin
  }

  // ── Leads (the `/register` form) ──────────────────────────────────────────

  @Get('leads')
  @UseGuards(OpsAuthGuard)
  listLeads(@Query() query: ListLeadsQueryDto): Promise<ClubSignupRequest[]> {
    return this.leads.list(query.status)
  }

  @Get('leads/summary')
  @UseGuards(OpsAuthGuard)
  leadsSummary(): Promise<LeadsSummary> {
    return this.leads.summary()
  }

  @Get('leads/:id')
  @UseGuards(OpsAuthGuard)
  getLead(@Param('id') id: string): Promise<ClubSignupRequest> {
    return this.leads.get(id)
  }

  /** Move a lead through the pipeline / write our notes on it. */
  @Patch('leads/:id')
  @UseGuards(OpsAuthGuard)
  updateLead(@Param('id') id: string, @Body() dto: UpdateLeadDto): Promise<ClubSignupRequest> {
    return this.leads.update(id, dto)
  }

  /** Provision the club from the lead's own answers, and mark the lead CONVERTED. */
  @Post('leads/:id/provision')
  @UseGuards(OpsAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  provisionLead(@Param('id') id: string, @Body() dto: ProvisionLeadDto): Promise<ClubSignupRequest> {
    return this.leads.provision(id, dto)
  }

  // ── Clubs (tenants) ───────────────────────────────────────────────────────

  @Get('clubs')
  @UseGuards(OpsAuthGuard)
  listClubs(): Promise<OpsClubRow[]> {
    return this.clubs.list()
  }

  /** Manual billing from the UI — the same thing `npm run subscription` does. */
  @Patch('clubs/:id/subscription')
  @UseGuards(OpsAuthGuard)
  updateSubscription(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto): Promise<SubscriptionState> {
    return this.clubs.updateSubscription(id, dto)
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  @Get('metrics/business')
  @UseGuards(OpsAuthGuard)
  business(): Promise<BusinessMetrics> {
    return this.metrics.getBusiness()
  }

  @Get('metrics/bot')
  @UseGuards(OpsAuthGuard)
  bot(): Promise<BotMetrics> {
    return this.metrics.getBot()
  }

  // ── Health ────────────────────────────────────────────────────────────────

  @Get('health')
  @UseGuards(OpsAuthGuard)
  systemHealth(): Promise<OpsHealth> {
    return this.health.get()
  }
}

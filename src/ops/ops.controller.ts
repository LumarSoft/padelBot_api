import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ClubSignupRequest } from 'generated/prisma/client'
import { OpsAuthGuard } from './guards/ops-auth.guard'
import { CurrentAdmin } from './decorators/current-admin.decorator'
import { AuthenticatedOpsAdmin } from './types/ops-jwt'
import { OpsAuthService, OpsLoginResult } from './ops-auth.service'
import { OpsLeadsService, LeadsSummary, SignupFunnel } from './ops-leads.service'
import { OpsClubsService, OpsClubRow, ClubUserRow } from './ops-clubs.service'
import { OpsMetricsService, BusinessMetrics, BotMetrics } from './ops-metrics.service'
import { OpsHealthService, OpsHealth } from './ops-health.service'
import { OpsHelpService, HelpSearchMissRow } from './ops-help.service'
import { OpsProfitabilityService, ProfitabilityReport } from './ops-profitability.service'
import { OpsClubDetail, OpsClubDetailService } from './ops-club-detail.service'
import { OpsWeeklySummaryService } from './ops-weekly-summary.service'
import { OpsImprovementRow, OpsImprovementsService, OpsImprovementSuggestionRow } from './ops-improvements.service'
import { SubscriptionState } from '../clubs/lib/subscription'
import { OpsLoginDto } from './dto/ops-login.dto'
import { UpdateLeadDto } from './dto/update-lead.dto'
import { ProvisionLeadDto } from './dto/provision-lead.dto'
import { UpdateSubscriptionDto } from './dto/update-subscription.dto'
import { ListLeadsQueryDto } from './dto/list-leads-query.dto'
import { ProfitabilityQueryDto } from './dto/profitability-query.dto'
import { UpdateClubNotesDto } from './dto/update-club-notes.dto'
import { SignupFunnelQueryDto } from './dto/signup-funnel-query.dto'
import { CreateImprovementDto } from './dto/create-improvement.dto'
import { UpdateImprovementDto } from './dto/update-improvement.dto'
import { UpdateImprovementSuggestionDto } from './dto/update-improvement-suggestion.dto'
import { ListImprovementSuggestionsQueryDto } from './dto/list-improvement-suggestions-query.dto'

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
    private readonly help: OpsHelpService,
    private readonly profitability: OpsProfitabilityService,
    private readonly clubDetail: OpsClubDetailService,
    private readonly weeklySummary: OpsWeeklySummaryService,
    private readonly improvements: OpsImprovementsService,
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
    return this.leads.list(query.status, query.due)
  }

  @Get('leads/summary')
  @UseGuards(OpsAuthGuard)
  leadsSummary(): Promise<LeadsSummary> {
    return this.leads.summary()
  }

  /** Where prospects drop out of the `/register` signup: visits per screen. */
  @Get('signup-funnel')
  @UseGuards(OpsAuthGuard)
  signupFunnel(@Query() query: SignupFunnelQueryDto): Promise<SignupFunnel> {
    return this.leads.funnel(query.days)
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

  /** Deletes a lead marked LOST, for good (the pipeline only keeps leads worth keeping). */
  @Delete('leads/:id')
  @UseGuards(OpsAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLead(@Param('id') id: string): Promise<void> {
    return this.leads.remove(id)
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

  /** The club's ficha: its row, our notes, the lead it came from, and the last months. */
  @Get('clubs/:id')
  @UseGuards(OpsAuthGuard)
  getClub(@Param('id') id: string): Promise<OpsClubDetail> {
    return this.clubDetail.detail(id)
  }

  @Patch('clubs/:id/notes')
  @UseGuards(OpsAuthGuard)
  updateClubNotes(@Param('id') id: string, @Body() dto: UpdateClubNotesDto): Promise<{ opsNotes: string | null }> {
    return this.clubDetail.updateNotes(id, dto.opsNotes ?? null)
  }

  /** Manual billing from the UI — the same thing `npm run subscription` does. */
  @Patch('clubs/:id/subscription')
  @UseGuards(OpsAuthGuard)
  updateSubscription(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto): Promise<SubscriptionState> {
    return this.clubs.updateSubscription(id, dto)
  }

  /** The club's panel users, so support can pick whose password to reset. */
  @Get('clubs/:id/users')
  @UseGuards(OpsAuthGuard)
  listClubUsers(@Param('id') id: string): Promise<ClubUserRow[]> {
    return this.clubs.listUsers(id)
  }

  /** Resets a club user's password to a fresh temporary one (returned once). */
  @Post('clubs/:id/users/:userId/reset-password')
  @UseGuards(OpsAuthGuard)
  @HttpCode(HttpStatus.OK)
  resetClubUserPassword(
    @Param('id') id: string,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<{ email: string; tempPassword: string }> {
    return this.clubs.resetUserPassword(id, userId)
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

  /** Per club and month: revenue, Meta + OpenAI cost and margin. */
  @Get('profitability')
  @UseGuards(OpsAuthGuard)
  profit(@Query() query: ProfitabilityQueryDto): Promise<ProfitabilityReport> {
    return this.profitability.report(query.month)
  }

  /** The text the next Monday summary to the ops channel would carry. */
  @Get('weekly-summary')
  @UseGuards(OpsAuthGuard)
  weekly(): Promise<{ text: string }> {
    return this.weeklySummary.preview()
  }

  // ── Health ────────────────────────────────────────────────────────────────

  @Get('health')
  @UseGuards(OpsAuthGuard)
  systemHealth(): Promise<OpsHealth> {
    return this.health.get()
  }

  // ── Staff help ────────────────────────────────────────────────────────────

  /** What the clubs' desk staff searched in the "?" help without finding it. */
  @Get('help/search-misses')
  @UseGuards(OpsAuthGuard)
  helpSearchMisses(): Promise<HelpSearchMissRow[]> {
    return this.help.searchMisses()
  }

  // ── Mejoras (improvements we post + the clubs' suggestions) ──────────────

  @Get('improvements')
  @UseGuards(OpsAuthGuard)
  listImprovements(): Promise<OpsImprovementRow[]> {
    return this.improvements.listImprovements()
  }

  @Post('improvements')
  @UseGuards(OpsAuthGuard)
  createImprovement(@Body() dto: CreateImprovementDto): Promise<OpsImprovementRow> {
    return this.improvements.createImprovement(dto)
  }

  @Patch('improvements/:id')
  @UseGuards(OpsAuthGuard)
  updateImprovement(@Param('id') id: string, @Body() dto: UpdateImprovementDto): Promise<OpsImprovementRow> {
    return this.improvements.updateImprovement(id, dto)
  }

  @Delete('improvements/:id')
  @UseGuards(OpsAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteImprovement(@Param('id') id: string): Promise<void> {
    return this.improvements.deleteImprovement(id)
  }

  @Get('improvement-suggestions')
  @UseGuards(OpsAuthGuard)
  listImprovementSuggestions(
    @Query() query: ListImprovementSuggestionsQueryDto,
  ): Promise<OpsImprovementSuggestionRow[]> {
    return this.improvements.listSuggestions(query.status)
  }

  @Patch('improvement-suggestions/:id')
  @UseGuards(OpsAuthGuard)
  updateImprovementSuggestion(
    @Param('id') id: string,
    @Body() dto: UpdateImprovementSuggestionDto,
  ): Promise<OpsImprovementSuggestionRow> {
    return this.improvements.updateSuggestion(id, dto)
  }
}

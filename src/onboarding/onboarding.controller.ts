import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { timingSafeEqual } from 'crypto'
import { AuthService, LoginResult } from '../auth/auth.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { OnboardingService, SetupStatus } from './onboarding.service'
import { RegisterClubDto } from './dto/register-club.dto'
import { RequestClubDto } from './dto/request-club.dto'
import { SaveSetupProgressDto } from './dto/save-setup-progress.dto'
import { SetupProgress } from './lib/setup-steps'

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Public lead form ("quiero mi club"): stores the request and alerts ops. Club
   * creation itself is MANAGED — we configure MercadoPago/WhatsApp and provision it.
   */
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  request(@Body() dto: RequestClubDto): Promise<{ received: boolean }> {
    return this.onboardingService.requestSignup(dto)
  }

  /**
   * Ops-only provisioning: creates the club + its OWNER on a trial. The club starts EMPTY;
   * the owner (with us alongside) loads courts, prices, payments and the WhatsApp line in the
   * `/setup` wizard. Guarded by a shared secret because it creates a tenant; fails closed
   * when unconfigured.
   *
   *   curl -X POST $API/onboarding/register -H "x-ops-secret: $OPS_ADMIN_SECRET" \
   *     -H 'Content-Type: application/json' \
   *     -d '{"clubName":"…","ownerName":"…","email":"…","password":"…"}'
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Headers('x-ops-secret') secret: string, @Body() dto: RegisterClubDto): Promise<LoginResult> {
    this.assertOpsSecret(secret)
    const { email } = await this.onboardingService.register(dto)
    return this.authService.login({ email, password: dto.password })
  }

  // ── Guided account setup (the `/setup` wizard) ───────────────────────────────

  /** Aggregated setup state: which steps are done (derived from real data) and where to resume. */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  getStatus(@CurrentUser() user: AuthenticatedUser): Promise<SetupStatus> {
    return this.onboardingService.getStatus(user.clubId)
  }

  /** Saves the wizard's position so an interrupted setup resumes where it left off. */
  @Patch('progress')
  @UseGuards(JwtAuthGuard)
  saveProgress(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveSetupProgressDto): Promise<SetupProgress> {
    this.assertOwner(user)
    return this.onboardingService.saveProgress(user.clubId, dto)
  }

  /** Marks the setup as finished. Steps may be left pending — they stay editable in Configuración. */
  @Post('complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  complete(@CurrentUser() user: AuthenticatedUser): Promise<{ setupCompletedAt: Date }> {
    this.assertOwner(user)
    return this.onboardingService.complete(user.clubId)
  }

  private assertOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño del club puede configurar la cuenta')
    }
  }

  /** Fail-closed constant-time check of the ops provisioning secret. */
  private assertOpsSecret(provided: string): void {
    const expected = process.env.OPS_ADMIN_SECRET
    if (!expected) throw new ForbiddenException('Provisioning is not configured')
    const a = Buffer.from(provided ?? '')
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid ops secret')
    }
  }
}

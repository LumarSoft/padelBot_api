import { Body, Controller, ForbiddenException, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { timingSafeEqual } from 'crypto'
import { AuthService, LoginResult } from '../auth/auth.service'
import { OnboardingService } from './onboarding.service'
import { RegisterClubDto } from './dto/register-club.dto'
import { RequestClubDto } from './dto/request-club.dto'

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
   * Ops-only provisioning: club + OWNER + trial + demo data, then auto-login payload
   * (we hand the credentials to the owner once MP/WhatsApp are set up). Guarded by a
   * shared secret because it creates a tenant; fails closed when unconfigured.
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

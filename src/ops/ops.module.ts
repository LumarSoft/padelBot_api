import { Module } from '@nestjs/common'
import { JwtModule, JwtSignOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { OnboardingModule } from '../onboarding/onboarding.module'
import { PaymentsModule } from '../payments/payments.module'
import { OpsController } from './ops.controller'
import { OpsAuthService } from './ops-auth.service'
import { OpsLeadsService } from './ops-leads.service'
import { OpsClubsService } from './ops-clubs.service'
import { OpsMetricsService } from './ops-metrics.service'
import { OpsHealthService } from './ops-health.service'
import { OpsJwtStrategy } from './strategies/ops-jwt.strategy'
import { opsJwtSecret } from './lib/ops-secret'

/**
 * The cross-tenant ops console.
 *
 * Its JwtModule is registered with OPS_JWT_SECRET — a different key from the tenant
 * AuthModule's. That is the load-bearing detail of this whole module: the two token
 * families are not interchangeable, so wiring a club route to the ops guard (or vice versa)
 * fails closed instead of leaking every tenant.
 *
 * It imports OnboardingModule and PaymentsModule rather than reimplementing provisioning
 * and poller health — the one-service-per-module rule bends here on purpose, because the
 * alternative is a second copy of tenant creation that can drift from the real one.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: opsJwtSecret(),
      signOptions: {
        // Shorter than a club session on purpose: this token sees every tenant.
        expiresIn: (process.env.OPS_JWT_EXPIRES_IN ?? '12h') as JwtSignOptions['expiresIn'],
      },
    }),
    OnboardingModule,
    PaymentsModule,
  ],
  controllers: [OpsController],
  providers: [OpsAuthService, OpsLeadsService, OpsClubsService, OpsMetricsService, OpsHealthService, OpsJwtStrategy],
})
export class OpsModule {}

import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { OnboardingController } from './onboarding.controller'
import { OnboardingService } from './onboarding.service'

@Module({
  imports: [AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  // The ops console provisions a club straight from a lead; it reuses this rather than
  // keeping a second copy of tenant creation that could drift.
  exports: [OnboardingService],
})
export class OnboardingModule {}

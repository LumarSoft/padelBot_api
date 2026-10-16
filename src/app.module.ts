import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from './prisma/prisma.module'
import { CryptoModule } from './common/crypto/crypto.module'
import { StorageModule } from './storage/storage.module'
import { PricingModule } from './pricing/pricing.module'
import { PlansModule } from './plans/plans.module'
import { BillingModule } from './billing/billing.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { OnboardingModule } from './onboarding/onboarding.module'
import { PlayersModule } from './players/players.module'
import { WaitlistModule } from './waitlist/waitlist.module'
import { CourtsModule } from './courts/courts.module'
import { SlotsModule } from './slots/slots.module'
import { BookingsModule } from './bookings/bookings.module'
import { RecurringBookingsModule } from './recurring-bookings/recurring-bookings.module'
import { WhatsAppLinesModule } from './whatsapp-lines/whatsapp-lines.module'
import { BotModule } from './bot/bot.module'
import { WhatsAppModule } from './whatsapp/whatsapp.module'
import { EventsModule } from './events/events.module'
import { PaymentsModule } from './payments/payments.module'
import { ClubsModule } from './clubs/clubs.module'
import { HelpModule } from './help/help.module'
import { ConversationsModule } from './conversations/conversations.module'
import { StatsModule } from './stats/stats.module'
import { PriceRulesModule } from './price-rules/price-rules.module'
import { NotificationsModule } from './notifications/notifications.module'
import { ProductsModule } from './products/products.module'
import { StockModule } from './stock/stock.module'
import { BookingRemindersModule } from './booking-reminders/booking-reminders.module'
import { OpsModule } from './ops/ops.module'
import { DemoModule } from './demo/demo.module'
import { FixedConfirmationsModule } from './fixed-confirmations/fixed-confirmations.module'
import { CompetitionsModule } from './competitions/competitions.module'
import { ImprovementsModule } from './improvements/improvements.module'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Global rate limit (per IP). Webhooks opt out via @SkipThrottle, login tightens
    // it via @Throttle. Behind a proxy, `trust proxy` is enabled in main.ts so the
    // real client IP is used instead of the proxy's.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.THROTTLE_LIMIT) || 120 }]),
    PrismaModule,
    CryptoModule,
    StorageModule,
    PricingModule,
    PlansModule,
    BillingModule,
    AuthModule,
    UsersModule,
    OnboardingModule,
    PlayersModule,
    WaitlistModule,
    CourtsModule,
    SlotsModule,
    BookingsModule,
    RecurringBookingsModule,
    WhatsAppLinesModule,
    BotModule,
    WhatsAppModule,
    EventsModule,
    PaymentsModule,
    ClubsModule,
    HelpModule,
    ConversationsModule,
    StatsModule,
    PriceRulesModule,
    NotificationsModule,
    ProductsModule,
    StockModule,
    BookingRemindersModule,
    OpsModule,
    DemoModule,
    FixedConfirmationsModule,
    CompetitionsModule,
    ImprovementsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

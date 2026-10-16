import { Module } from '@nestjs/common'
import { PlayersModule } from '../players/players.module'
import { EventsModule } from '../events/events.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { CompetitionsController } from './competitions.controller'
import { CompetitionsService } from './competitions.service'
import { CompetitionSignupsController } from './competition-signups.controller'
import { CompetitionSignupsService } from './competition-signups.service'

@Module({
  imports: [PlayersModule, EventsModule, NotificationsModule],
  controllers: [CompetitionsController, CompetitionSignupsController],
  providers: [CompetitionsService, CompetitionSignupsService],
  // The bot and the LLM offer the open events and take sign-up requests.
  exports: [CompetitionSignupsService],
})
export class CompetitionsModule {}

import { Module } from '@nestjs/common'
import { PlayersModule } from '../players/players.module'
import { EventsModule } from '../events/events.module'
import { CompetitionsController } from './competitions.controller'
import { CompetitionsService } from './competitions.service'

@Module({
  imports: [PlayersModule, EventsModule],
  controllers: [CompetitionsController],
  providers: [CompetitionsService],
})
export class CompetitionsModule {}

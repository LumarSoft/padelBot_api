import { Module } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { StatsController } from './stats.controller'
import { StatsService } from './stats.service'
import { StatsReportsService } from './stats-reports.service'

@Module({
  imports: [NotificationsModule],
  controllers: [StatsController],
  providers: [StatsService, StatsReportsService],
})
export class StatsModule {}

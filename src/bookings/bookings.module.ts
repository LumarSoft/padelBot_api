import { Module } from '@nestjs/common'
import { BookingsController } from './bookings.controller'
import { BookingsService } from './bookings.service'
import { EventsModule } from '../events/events.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { PlayersModule } from '../players/players.module'
import { StockModule } from '../stock/stock.module'

@Module({
  imports: [EventsModule, NotificationsModule, PlayersModule, StockModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}

import { Module } from '@nestjs/common'
import { BookingsController } from './bookings.controller'
import { BookingsService } from './bookings.service'
import { EventsModule } from '../events/events.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [EventsModule, NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}

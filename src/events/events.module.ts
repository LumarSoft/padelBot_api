import { Module } from '@nestjs/common'
import { EventsController } from './events.controller'
import { BookingEventsService } from './booking-events.service'

@Module({
  controllers: [EventsController],
  providers: [BookingEventsService],
  exports: [BookingEventsService],
})
export class EventsModule {}

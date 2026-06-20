import { Module } from '@nestjs/common'
import { RecurringBookingsController } from './recurring-bookings.controller'
import { RecurringBookingsService } from './recurring-bookings.service'

@Module({
  controllers: [RecurringBookingsController],
  providers: [RecurringBookingsService],
  exports: [RecurringBookingsService],
})
export class RecurringBookingsModule {}

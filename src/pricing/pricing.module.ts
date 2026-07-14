import { Global, Module } from '@nestjs/common'
import { SlotPricingService } from './slot-pricing.service'

/**
 * Shared pricing logic. Global because three unrelated modules move prices around —
 * courts (default price + bulk adjustments), price-rules (band exceptions) and bookings
 * (a cancellation puts the band back on sale) — and all of them must leave the slots'
 * quoted price consistent with the club's price list.
 */
@Global()
@Module({
  providers: [SlotPricingService],
  exports: [SlotPricingService],
})
export class PricingModule {}

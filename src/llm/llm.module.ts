import { Module } from '@nestjs/common'
import { AvailabilityModule } from '../availability/availability.module'
import { LlmService } from './llm.service'

@Module({
  imports: [AvailabilityModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}

import { Module } from '@nestjs/common'
import { AvailabilityModule } from '../availability/availability.module'
import { CompetitionsModule } from '../competitions/competitions.module'
import { LlmService } from './llm.service'

@Module({
  imports: [AvailabilityModule, CompetitionsModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}

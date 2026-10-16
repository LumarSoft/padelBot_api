import { Module } from '@nestjs/common'
import { ImprovementsController } from './improvements.controller'
import { ImprovementsService } from './improvements.service'

/** "Mejoras": published improvements and the clubs' suggestions to Lumarsoft. */
@Module({
  controllers: [ImprovementsController],
  providers: [ImprovementsService],
})
export class ImprovementsModule {}

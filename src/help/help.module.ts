import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { HelpController } from './help.controller'
import { HelpService } from './help.service'
import { DeskActionInterceptor } from './desk-action.interceptor'

/**
 * Staff help. Registers DeskActionInterceptor app-wide, so any controller can mark a desk
 * action with `@RecordsDeskAction(...)` without importing this module or touching its service.
 */
@Module({
  controllers: [HelpController],
  providers: [HelpService, { provide: APP_INTERCEPTOR, useClass: DeskActionInterceptor }],
})
export class HelpModule {}

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'
import { Observable, tap } from 'rxjs'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { HelpService } from './help.service'
import { DESK_ACTION_KEY, DeskActionMetadata } from './lib/desk-action.decorator'

/**
 * Global interceptor behind `@RecordsDeskAction`: after a marked endpoint succeeds, records the
 * caller's first time doing that desk action. Fire-and-forget — the response never waits on it
 * and a failure here is only logged (HelpService.recordFirstAction swallows it).
 */
@Injectable()
export class DeskActionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly helpService: HelpService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<DeskActionMetadata | undefined>(DESK_ACTION_KEY, context.getHandler())
    if (!meta) return next.handle()

    const request = context.switchToHttp().getRequest<Request>()
    const user = request.user as AuthenticatedUser | undefined
    const userId = Number(user?.id)
    if (!Number.isInteger(userId) || (meta.when && !meta.when(request.body))) return next.handle()

    return next.handle().pipe(
      tap(() => {
        void this.helpService.recordFirstAction(userId, meta.action)
      }),
    )
  }
}

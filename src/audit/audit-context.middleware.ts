import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { resolveSource, runWithAuditContext } from './lib/audit-context'

/**
 * Opens the audit context for the whole request. Middleware on purpose: it wraps `next()`
 * synchronously, so guards, pipes, the handler and every service they call run inside the
 * same AsyncLocalStorage scope and can reach the context without threading it as a parameter.
 */
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    runWithAuditContext(
      {
        // `trust proxy` is on in main.ts, so `req.ip` is the real client address.
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        source: resolveSource(req.headers['x-client']),
      },
      () => next(),
    )
  }
}

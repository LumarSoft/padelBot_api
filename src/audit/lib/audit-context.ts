import { AsyncLocalStorage } from 'async_hooks'
import type { AuditSource } from 'generated/prisma/client'

/**
 * Per-request context the audit log needs but the services doing the work don't have:
 * who is on the other end, from which client, and from which IP.
 *
 * It is established by `AuditContextMiddleware` (middleware, not an interceptor — the whole
 * downstream chain has to run *inside* the AsyncLocalStorage scope, and an interceptor's
 * `next.handle()` is subscribed after it returns). The middleware runs before the auth guard,
 * so the actor starts empty and `JwtStrategy` fills it in by mutating the same object.
 */
export interface AuditRequestContext {
  ip?: string
  userAgent?: string
  source: AuditSource
  userId?: number
  clubId?: string
  /** Frozen at the time of the event: "Lucas Quaroni (dueño)". Survives the user's deletion. */
  actorLabel?: string
}

const storage = new AsyncLocalStorage<AuditRequestContext>()

export function runWithAuditContext<T>(context: AuditRequestContext, fn: () => T): T {
  return storage.run(context, fn)
}

export function getAuditContext(): AuditRequestContext | undefined {
  return storage.getStore()
}

/** Called from the JWT strategy once the request is authenticated. */
export function setAuditActor(actor: { userId: number; clubId: string; label: string }): void {
  const context = storage.getStore()
  if (!context) return
  context.userId = actor.userId
  context.clubId = actor.clubId
  context.actorLabel = actor.label
}

/** Maps the `x-client` header a client declares to the stored source. Unknown → API. */
export function resolveSource(header: unknown): AuditSource {
  const value = Array.isArray(header) ? header[0] : header
  switch (String(value ?? '').toLowerCase()) {
    case 'panel':
      return 'PANEL'
    case 'mobile':
      return 'MOBILE'
    default:
      return 'API'
  }
}

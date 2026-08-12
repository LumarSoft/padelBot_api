import { Injectable, Logger } from '@nestjs/common'
import type { AuditAction, AuditActorType, AuditSource } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { getAuditContext } from './lib/audit-context'

/** Never let a secret reach the audit log, not even as a "previous value". */
const SENSITIVE_FIELDS = new Set([
  'password',
  'tokenHash',
  'mpAccessToken',
  'mpRefreshToken',
  'token',
])
const REDACTED = '[REDACTADO]'

export interface AuditChange {
  field: string
  from: unknown
  to: unknown
}

export interface AuditActor {
  type: AuditActorType
  label: string
  userId?: number
}

export interface RecordAuditInput {
  action: AuditAction
  /** "Booking" | "User" | "PermissionGroup" | "Session" */
  entity: string
  entityId: string
  /** Human-readable, Spanish, reads straight into the report. */
  summary: string
  clubId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  /** Restricts the diff to the fields worth auditing. Omit to diff everything present. */
  fields?: string[]
  /** Overrides the actor taken from the request context (the bot and cron jobs need this). */
  actor?: AuditActor
  /** Overrides the source taken from the request context. */
  source?: AuditSource
}

type Plain = Record<string, unknown>

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one audit entry. Deliberately swallows its own errors: auditing must never be the
   * reason a booking fails to confirm. A failure here is logged and the business operation
   * continues.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      const context = getAuditContext()
      const actor = this.resolveActor(input.actor, context?.userId, context?.actorLabel)
      const before = this.sanitize(input.before)
      const after = this.sanitize(input.after)
      const changes = before && after ? this.diff(before, after, input.fields) : null

      await this.prisma.auditLog.create({
        data: {
          clubId: input.clubId ?? context?.clubId ?? null,
          userId: actor.userId ?? null,
          actorLabel: actor.label,
          actorType: actor.type,
          source: input.source ?? context?.source ?? 'API',
          action: input.action,
          entity: input.entity,
          entityId: input.entityId,
          summary: input.summary,
          before: before ?? undefined,
          after: after ?? undefined,
          changes: changes && changes.length > 0 ? changes : undefined,
          ip: context?.ip ?? null,
          userAgent: context?.userAgent ?? null,
        },
      })
    } catch (error) {
      this.logger.error(
        `No se pudo registrar la auditoría de ${input.entity}:${input.entityId} (${input.action})`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  /**
   * Field-by-field difference between two states. This is what answers "cuáles eran los
   * valores originales": every entry keeps the previous value next to the new one.
   */
  diff(before: Plain, after: Plain, fields?: string[]): AuditChange[] {
    const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])]
    const changes: AuditChange[] = []
    for (const field of keys) {
      const from = before[field]
      const to = after[field]
      if (!this.equal(from, to)) changes.push({ field, from: from ?? null, to: to ?? null })
    }
    return changes
  }

  /** Copies the object replacing secrets and normalising values the JSON column can't hold. */
  sanitize(value?: Record<string, unknown> | null): Plain | null {
    if (!value) return null
    const output: Plain = {}
    for (const [key, raw] of Object.entries(value)) {
      if (SENSITIVE_FIELDS.has(key)) {
        output[key] = REDACTED
        continue
      }
      output[key] = this.normalize(raw)
    }
    return output
  }

  private normalize(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'bigint') return Number(value)
    if (value === undefined) return null
    return value
  }

  private equal(a: unknown, b: unknown): boolean {
    const left = this.normalize(a)
    const right = this.normalize(b)
    if (left === right) return true
    if (left === null || right === null) return false
    if (typeof left === 'object' || typeof right === 'object') {
      return JSON.stringify(left) === JSON.stringify(right)
    }
    return false
  }

  private resolveActor(
    explicit: AuditActor | undefined,
    contextUserId: number | undefined,
    contextLabel: string | undefined,
  ): AuditActor {
    if (explicit) return explicit
    if (contextUserId) {
      return { type: 'USER', label: contextLabel ?? `Usuario #${contextUserId}`, userId: contextUserId }
    }
    return { type: 'SYSTEM', label: 'Sistema' }
  }
}

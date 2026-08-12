import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { dayRangeUtc } from '../availability/lib/datetime'

export interface AuditSummaryRow {
  key: string
  label: string
  count: number
}

export interface AuditSummaryReport {
  from: string
  to: string
  total: number
  /** Events grouped by action — the "qué se hizo" of the report. */
  byAction: AuditSummaryRow[]
  /** Events grouped by the person who did them — the "quién". */
  byUser: AuditSummaryRow[]
  /** Events per day — the series the chart draws. */
  byDay: AuditSummaryRow[]
  /** Sessions opened, closed and rejected in the period. */
  sessions: { logins: number; logouts: number; failed: number }
}

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Altas',
  UPDATE: 'Modificaciones',
  DELETE: 'Bajas',
  STATUS_CHANGE: 'Cambios de estado',
  LOGIN: 'Inicios de sesión',
  LOGOUT: 'Cierres de sesión',
  LOGIN_FAILED: 'Intentos fallidos',
  PASSWORD_CHANGED: 'Cambios de clave',
  PASSWORD_RESET_REQUESTED: 'Recuperaciones solicitadas',
  PASSWORD_RESET_COMPLETED: 'Recuperaciones completadas',
  PERMISSION_CHANGED: 'Cambios de permisos',
}

@Injectable()
export class AuditReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregated audit report: what happened, who did it and when. Feeds the "Reporte" tab of
   * the panel, which is one of the two implemented reports the product ships.
   */
  async getSummary(clubId: string, from: string, to: string): Promise<AuditSummaryReport> {
    const { gte } = dayRangeUtc(from)
    const { lt } = dayRangeUtc(to)
    const where = { clubId, createdAt: { gte, lt } }

    const [byActionRaw, byUserRaw, rows] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['action'], where, _count: { _all: true } }),
      this.prisma.auditLog.groupBy({
        by: ['actorLabel'],
        where,
        _count: { _all: true },
        orderBy: { _count: { actorLabel: 'desc' } },
        take: 20,
      }),
      this.prisma.auditLog.findMany({ where, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
    ])

    const byAction = byActionRaw
      .map((row) => ({
        key: row.action,
        label: ACTION_LABELS[row.action] ?? row.action,
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count)

    const byUser = byUserRaw.map((row) => ({
      key: row.actorLabel,
      label: row.actorLabel,
      count: row._count._all,
    }))

    const perDay = new Map<string, number>()
    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10)
      perDay.set(key, (perDay.get(key) ?? 0) + 1)
    }
    const byDay = [...perDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({ key, label: key, count }))

    const countOf = (action: string) => byAction.find((row) => row.key === action)?.count ?? 0

    return {
      from,
      to,
      total: rows.length,
      byAction,
      byUser,
      byDay,
      sessions: {
        logins: countOf('LOGIN'),
        logouts: countOf('LOGOUT'),
        failed: countOf('LOGIN_FAILED'),
      },
    }
  }
}

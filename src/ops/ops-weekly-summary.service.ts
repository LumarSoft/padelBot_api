import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { notifyOps } from '../common/ops-alert'
import { schedulerEnabled } from '../common/scheduling'
import { shiftDateKey, todayKey, wallTimeToUtc } from '../availability/lib/datetime'
import { monthName } from '../plans/lib/ai-credits'
import { SALES_DEMO_SLUG } from '../demo/sales-demo.seed'
import { answerLabel } from '../onboarding/lib/signup-answers'
import { OpsClubsService } from './ops-clubs.service'
import { OpsMetricsService } from './ops-metrics.service'

/** The week in numbers, as the Monday message tells it. */
export interface WeeklySummaryData {
  /** First and last club-local day of the week ("YYYY-MM-DD"). */
  from: string
  to: string
  leads: {
    new: number
    /** "Instagram 2", most first. */
    channels: { label: string; count: number }[]
    contacted: number
    /** NEW for more than a day: a call we owe. */
    waiting: number
    /** Open leads to call back today or overdue. */
    dueToday: number
  }
  /** Visitors who opened the signup's first screen. */
  signupStarted: number
  clubs: {
    paying: number
    trial: number
    mrrCents: number
    /** Last month's recurring revenue, when it was tracked. */
    previousMrrCents: number | null
    previousMonth: string
    created: string[]
    paused: string[]
    atRisk: string[]
    trialEnding: string[]
  }
  bookings: { bot: number; panel: number }
}

const count = (n: number) => n.toLocaleString('es-AR')
const pesos = (cents: number) => `$${Math.round(cents / 100).toLocaleString('es-AR')}`

/** "6 al 12 de octubre" (or "29 de septiembre al 5 de octubre"). */
function weekLabel(from: string, to: string): string {
  const [, fromMonth, fromDay] = from.split('-').map(Number)
  const [, toMonth, toDay] = to.split('-').map(Number)
  const toName = monthName(to.slice(0, 7))
  return fromMonth === toMonth
    ? `${fromDay} al ${toDay} de ${toName}`
    : `${fromDay} de ${monthName(from.slice(0, 7))} al ${toDay} de ${toName}`
}

/** The Monday message for the ops channel: only the lines that have something to say. */
export function formatWeeklySummary(data: WeeklySummaryData): string {
  const { leads, clubs, bookings } = data
  const lines = [`📊 *Resumen semanal de GTP* — ${weekLabel(data.from, data.to)}`, '']

  const leadParts = [`${count(leads.new)} ${leads.new === 1 ? 'nueva' : 'nuevas'}`]
  if (leads.channels.length) {
    leadParts[0] += ` (${leads.channels.map(c => `${c.label} ${c.count}`).join(', ')})`
  }
  leadParts.push(`${count(leads.contacted)} contactadas`)
  if (leads.waiting) leadParts.push(`⚠️ ${count(leads.waiting)} sin contactar hace más de un día`)
  if (leads.dueToday) leadParts.push(`📞 ${count(leads.dueToday)} para llamar hoy`)
  lines.push(`*Solicitudes:* ${leadParts.join(' · ')}`)

  if (data.signupStarted > 0) {
    const share = Math.round((leads.new * 100) / data.signupStarted)
    lines.push(`*Registro:* ${count(data.signupStarted)} lo empezaron y ${count(leads.new)} lo enviaron (${share}%)`)
  }

  let revenue = `ingreso recurrente ${pesos(clubs.mrrCents)}`
  if (clubs.previousMrrCents !== null) {
    const diff = clubs.mrrCents - clubs.previousMrrCents
    if (diff !== 0)
      revenue += ` (${diff > 0 ? '+' : '−'}${pesos(Math.abs(diff))} vs. ${monthName(clubs.previousMonth)})`
  }
  lines.push(`*Clubes:* ${count(clubs.paying)} pagando · ${count(clubs.trial)} en prueba · ${revenue}`)
  if (clubs.created.length) lines.push(`*Altas:* ${clubs.created.join(', ')}`)

  const attention = [
    clubs.paused.length && `⏸️ bot pausado: ${clubs.paused.join(', ')}`,
    clubs.atRisk.length && `⚠️ en riesgo: ${clubs.atRisk.join(', ')}`,
    clubs.trialEnding.length && `⏳ prueba por vencer: ${clubs.trialEnding.join(', ')}`,
  ].filter(Boolean)
  lines.push(`*Para atender:* ${attention.length ? attention.join(' · ') : 'nada urgente.'}`)

  const total = bookings.bot + bookings.panel
  if (total > 0) {
    const share = Math.round((bookings.bot * 100) / total)
    lines.push(`*Reservas:* ${count(bookings.bot)} por el bot y ${count(bookings.panel)} por el panel (${share}% bot)`)
  }
  return lines.join('\n')
}

/**
 * Every Monday at 9 (club-local) the ops channel gets last week in one message: leads, the
 * signup, recurring revenue, new clubs, the clubs that need us, and how the bot booked. The
 * sales demo is left out.
 */
@Injectable()
export class OpsWeeklySummaryService {
  private readonly logger = new Logger(OpsWeeklySummaryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubs: OpsClubsService,
    private readonly metrics: OpsMetricsService,
  ) {}

  @Cron('0 9 * * 1', { timeZone: process.env.CLUB_TIMEZONE ?? 'America/Argentina/Buenos_Aires' })
  async sendWeekly(): Promise<void> {
    if (!schedulerEnabled()) return
    try {
      await notifyOps(formatWeeklySummary(await this.collect()))
    } catch (err) {
      this.logger.error('Could not send the weekly summary', err)
    }
  }

  /** The text the next Monday message would carry, for the console to preview. */
  async preview(): Promise<{ text: string }> {
    return { text: formatWeeklySummary(await this.collect()) }
  }

  /** The last seven club-local days, ending yesterday. */
  async collect(today: string = todayKey()): Promise<WeeklySummaryData> {
    const from = shiftDateKey(today, -7)
    const to = shiftDateKey(today, -1)
    const window = { gte: wallTimeToUtc(from, '00:00'), lt: wallTimeToUtc(today, '00:00') }
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const [newLeads, contacted, waiting, dueToday, funnel, rows, business, bookings, created] = await Promise.all([
      this.prisma.clubSignupRequest.findMany({ where: { createdAt: window }, select: { howFound: true } }),
      this.prisma.clubSignupRequest.count({ where: { contactedAt: window } }),
      this.prisma.clubSignupRequest.count({ where: { status: 'NEW', createdAt: { lt: dayAgo } } }),
      this.prisma.clubSignupRequest.count({
        where: {
          status: { in: ['NEW', 'CONTACTED'] },
          followUpAt: { lt: wallTimeToUtc(shiftDateKey(today, 1), '00:00') },
        },
      }),
      this.prisma.signupFunnelDaily.aggregate({
        where: { dateKey: { gte: from, lte: to }, stepIndex: 0 },
        _sum: { visits: true },
      }),
      this.clubs.list(),
      this.metrics.getBusiness(),
      this.prisma.booking.findMany({
        where: { createdAt: window, club: { slug: { not: SALES_DEMO_SLUG } } },
        select: { bookedByUserId: true },
      }),
      this.prisma.club.findMany({
        where: { createdAt: window, slug: { not: SALES_DEMO_SLUG } },
        select: { name: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const channels = new Map<string, number>()
    for (const lead of newLeads) {
      const label = answerLabel(lead.howFound) ?? 'sin dato'
      channels.set(label, (channels.get(label) ?? 0) + 1)
    }
    const real = rows.filter(row => !row.isDemo)
    const named = (status: string) => real.filter(row => row.health.status === status).map(row => row.name)
    const months = business.months
    const current = months[months.length - 1]
    const previous = months.length > 1 ? months[months.length - 2] : null

    return {
      from,
      to,
      leads: {
        new: newLeads.length,
        channels: [...channels.entries()]
          .map(([label, n]) => ({ label, count: n }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3),
        contacted,
        waiting,
        dueToday,
      },
      signupStarted: funnel._sum.visits ?? 0,
      clubs: {
        paying: real.filter(row => row.subscription.subscriptionStatus === 'ACTIVE').length,
        trial: real.filter(row => row.subscription.subscriptionStatus === 'TRIAL').length,
        mrrCents: current?.tracked ? (current.mrrCents ?? 0) : business.mrrCents,
        previousMrrCents: previous?.tracked ? previous.mrrCents : null,
        previousMonth: previous?.month ?? '',
        created: created.map(club => club.name),
        paused: named('botPaused'),
        atRisk: named('atRisk'),
        trialEnding: named('trialEnding'),
      },
      bookings: {
        bot: bookings.filter(b => b.bookedByUserId === null).length,
        panel: bookings.filter(b => b.bookedByUserId !== null).length,
      },
    }
  }
}

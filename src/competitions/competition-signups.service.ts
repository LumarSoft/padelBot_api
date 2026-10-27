import { Injectable, NotFoundException } from '@nestjs/common'
import { CompetitionKind, CompetitionStatus, SignupRequestStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { BookingEventsService } from '../events/booking-events.service'
import { todayKey } from '../availability/lib/datetime'
import { QuerySignupRequestsDto } from './dto/query-signup-requests.dto'

/** How many events the bot offers at once — WhatsApp lists take at most 10 rows. */
const MAX_OFFERED = 10

/** A torneo or peña the bot can offer: open for registration, with a session today or later. */
export interface OpenCompetition {
  id: string
  kind: CompetitionKind
  name: string
  entryFeeCents: number
  /** The first session still ahead (club-local), the one the bot shows. */
  dateKey: string
  startTime: string
  /** Sessions in all (a torneo can span several days). */
  sessionCount: number
  categories: string[]
}

const requestSelect = {
  id: true,
  competitionId: true,
  waId: true,
  playerName: true,
  status: true,
  handledAt: true,
  createdAt: true,
  competition: { select: { id: true, name: true, kind: true, status: true } },
} as const

/**
 * Sign-up requests that come in through the WhatsApp bot. The bot shows the open torneos and
 * peñas, the player picks one, and this records the request and tells the club — registering
 * the pair stays a desk job (panel or app), because the club wants to talk to the player first.
 */
@Injectable()
export class CompetitionSignupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly events: BookingEventsService,
  ) {}

  /** The events a player can ask to join right now, soonest first. */
  async openForPlayers(clubId: string): Promise<OpenCompetition[]> {
    const today = todayKey()
    const rows = await this.prisma.competition.findMany({
      where: { clubId, status: CompetitionStatus.OPEN, sessions: { some: { dateKey: { gte: today } } } },
      select: {
        id: true,
        kind: true,
        name: true,
        entryFeeCents: true,
        sessions: {
          select: { dateKey: true, startTime: true },
          orderBy: [{ dateKey: 'asc' }, { startTime: 'asc' }],
        },
        categories: { select: { name: true }, orderBy: { createdAt: 'asc' } },
      },
    })
    return rows
      .map(row => {
        const next = row.sessions.find(s => s.dateKey >= today) ?? row.sessions[0]
        return {
          id: row.id,
          kind: row.kind,
          name: row.name,
          entryFeeCents: row.entryFeeCents,
          dateKey: next.dateKey,
          startTime: next.startTime,
          sessionCount: row.sessions.length,
          // A peña's only category is the automatic "General" — not worth showing.
          categories: row.kind === CompetitionKind.TOURNAMENT ? row.categories.map(c => c.name) : [],
        }
      })
      .sort((a, b) => `${a.dateKey} ${a.startTime}`.localeCompare(`${b.dateKey} ${b.startTime}`))
      .slice(0, MAX_OFFERED)
  }

  /**
   * Records that a player wants in and tells the club (push + the panel's inbox). Asking twice
   * for the same event while the first request is still pending doesn't pile up nor push again.
   * Returns null when the event is no longer open, so the bot can say so.
   */
  async request(
    clubId: string,
    input: { competitionId: string; waId: string; playerName?: string | null },
  ): Promise<{ competitionName: string; alreadyPending: boolean } | null> {
    const competition = await this.prisma.competition.findFirst({
      where: { id: input.competitionId, clubId, status: CompetitionStatus.OPEN },
      select: { id: true, name: true, kind: true },
    })
    if (!competition) return null

    const pending = await this.prisma.competitionSignupRequest.findFirst({
      where: { clubId, competitionId: competition.id, waId: input.waId, status: SignupRequestStatus.PENDING },
      select: { id: true },
    })
    if (pending) return { competitionName: competition.name, alreadyPending: true }

    const playerName = input.playerName?.trim().slice(0, 100) || null
    await this.prisma.competitionSignupRequest.create({
      data: { clubId, competitionId: competition.id, waId: input.waId, playerName },
    })

    const who = playerName ?? 'Un jugador'
    const kindLabel = competition.kind === CompetitionKind.PENA ? 'la peña' : 'el torneo'
    await this.notifications.notifyClub(clubId, {
      title: `🏆 Quieren anotarse a ${competition.name}`,
      body: `${who} pidió inscribirse a ${kindLabel} por WhatsApp. Respondele desde Conversaciones.`,
      data: { competitionId: competition.id },
    })
    this.events.emitCompetitionSignup({
      type: 'competition.signup',
      clubId,
      competitionId: competition.id,
      competitionName: competition.name,
      playerName,
    })
    return { competitionName: competition.name, alreadyPending: false }
  }

  list(clubId: string, query: QuerySignupRequestsDto) {
    return this.prisma.competitionSignupRequest.findMany({
      where: {
        clubId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.competitionId ? { competitionId: query.competitionId } : {}),
      },
      select: requestSelect,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }

  async setStatus(clubId: string, id: string, status: SignupRequestStatus) {
    const existing = await this.prisma.competitionSignupRequest.findFirst({
      where: { id, clubId },
      select: { id: true, competitionId: true },
    })
    if (!existing) throw new NotFoundException('Solicitud no encontrada')
    const updated = await this.prisma.competitionSignupRequest.update({
      where: { id },
      data: { status, handledAt: status === SignupRequestStatus.PENDING ? null : new Date() },
      select: requestSelect,
    })
    // Other screens (another desk, the owner's phone) drop it from their inbox too.
    this.events.emitCompetitionChanged({ type: 'competition.changed', clubId, competitionId: existing.competitionId })
    return updated
  }
}

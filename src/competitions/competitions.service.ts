import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import {
  CategoryFormat,
  CompetitionKind,
  CompetitionStatus,
  MatchFormat,
  MatchStage,
  PlayerPaymentMethod,
  Prisma,
  SlotStatus,
} from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { PlayersService, normalizePhone } from '../players/players.service'
import { BookingEventsService } from '../events/booking-events.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { courtScheduleSelect, CourtSchedule } from '../availability/lib/schedule'
import { dayLabelFromKey, formatTime, toDateKey } from '../availability/lib/datetime'
import { bandsOverlapping, sessionWindow, SessionTimes, TimeWindow } from './lib/blocks'
import { packIntoWaves, roundRobinPairings } from './lib/round-robin'
import { groupName, splitIntoGroups } from './lib/groups'
import { BracketEntrant, buildBracket } from './lib/bracket'
import { evaluateScore, SetScore } from './lib/score'
import { computeStandings, StandingRow } from './lib/standings'
import { CreateCompetitionDto } from './dto/create-competition.dto'
import { UpdateCompetitionDto } from './dto/update-competition.dto'
import { QueryCompetitionsDto } from './dto/query-competitions.dto'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { CreatePairDto, PairPlayerDto } from './dto/create-pair.dto'
import { UpdatePairDto } from './dto/update-pair.dto'
import { UpdatePlayerPaymentDto } from './dto/update-player-payment.dto'
import { UpdateMatchDto } from './dto/update-match.dto'

type Tx = Prisma.TransactionClient

const sessionSelect = { id: true, dateKey: true, startTime: true, endTime: true } as const
const sessionOrder: Prisma.CompetitionSessionOrderByWithRelationInput[] = [{ dateKey: 'asc' }, { startTime: 'asc' }]

const competitionListSelect = {
  id: true,
  kind: true,
  name: true,
  description: true,
  status: true,
  matchFormat: true,
  entryFeeCents: true,
  createdAt: true,
  updatedAt: true,
  sessions: { select: sessionSelect, orderBy: sessionOrder },
  courts: { select: { court: { select: { id: true, name: true } } } },
  _count: { select: { pairs: true, categories: true } },
} as const

const playerSelect = {
  id: true,
  position: true,
  name: true,
  phone: true,
  playerId: true,
  paidAt: true,
  paymentMethod: true,
} as const

const pairSelect = {
  id: true,
  categoryId: true,
  groupId: true,
  seed: true,
  createdAt: true,
  players: { select: playerSelect, orderBy: { position: 'asc' as const } },
} as const

const matchSelect = {
  id: true,
  categoryId: true,
  stage: true,
  groupId: true,
  round: true,
  position: true,
  pairAId: true,
  pairBId: true,
  placeholderA: true,
  placeholderB: true,
  courtId: true,
  startsAt: true,
  sets: true,
  winnerPairId: true,
  nextMatchId: true,
  nextSlot: true,
} as const

const competitionDetailSelect = {
  ...competitionListSelect,
  categories: {
    select: {
      id: true,
      name: true,
      format: true,
      groupSize: true,
      advancePerGroup: true,
      maxPairs: true,
      fixtureGeneratedAt: true,
      bracketGeneratedAt: true,
      groups: { select: { id: true, name: true, position: true }, orderBy: { position: 'asc' as const } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  pairs: { select: pairSelect, orderBy: { createdAt: 'asc' as const } },
  matches: {
    select: matchSelect,
    orderBy: [
      { stage: 'asc' },
      { round: 'asc' },
      { position: 'asc' },
    ] as Prisma.CompetitionMatchOrderByWithRelationInput[],
  },
} as const

/** How many booked turnos the conflict message lists before "y N más". */
const MAX_CONFLICTS_LISTED = 5

type DetailRow = Prisma.CompetitionGetPayload<{ select: typeof competitionDetailSelect }>
type PairRow = DetailRow['pairs'][number]

@Injectable()
export class CompetitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly players: PlayersService,
    private readonly events: BookingEventsService,
  ) {}

  // ─── Events ──────────────────────────────────────────────────────────────────

  async findAll(clubId: string, query: QueryCompetitionsDto) {
    const rows = await this.prisma.competition.findMany({
      where: {
        clubId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      select: competitionListSelect,
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(({ courts, ...row }) => ({ ...row, courts: courts.map(c => c.court) }))
  }

  async findOne(clubId: string, id: string) {
    const row = await this.prisma.competition.findFirst({ where: { id, clubId }, select: competitionDetailSelect })
    if (!row) throw new NotFoundException('Evento no encontrado')
    return this.present(row)
  }

  async create(clubId: string, createdByUserId: number, dto: CreateCompetitionDto) {
    const categories: CreateCategoryDto[] =
      dto.kind === CompetitionKind.PENA
        ? [{ name: 'General', format: CategoryFormat.ROUND_ROBIN }]
        : (dto.categories ?? [])
    if (categories.length === 0) throw new BadRequestException('El torneo necesita al menos una categoría')
    categories.forEach(c => this.assertCategoryShape(c))

    const courts = await this.loadCourts(clubId, dto.courtIds)
    const sessions = this.validateSessions(dto.sessions)

    const id = await this.prisma.$transaction(async tx => {
      const competition = await tx.competition.create({
        data: {
          clubId,
          kind: dto.kind,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          matchFormat: dto.matchFormat ?? MatchFormat.ONE_SET,
          entryFeeCents: dto.entryFeeCents ?? 0,
          createdByUserId,
          sessions: { create: sessions.map(s => ({ clubId, ...s })) },
          courts: { create: courts.map(c => ({ clubId, courtId: c.id })) },
          categories: { create: categories.map(c => ({ clubId, ...this.categoryData(c) })) },
        },
        select: { id: true },
      })
      await this.syncBlocks(tx, clubId, competition.id, courts, sessions)
      return competition.id
    })

    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  async update(clubId: string, id: string, dto: UpdateCompetitionDto) {
    const current = await this.loadCompetition(clubId, id)
    this.assertNotCancelled(current.status)

    if (dto.matchFormat && dto.matchFormat !== current.matchFormat) {
      const played = await this.prisma.competitionMatch.count({
        where: { competitionId: id, clubId, winnerPairId: { not: null }, sets: { not: Prisma.DbNull } },
      })
      if (played > 0) throw new ConflictException('Ya hay resultados cargados: no se puede cambiar el formato')
    }

    const courts = dto.courtIds ? await this.loadCourts(clubId, dto.courtIds) : null
    const sessions = dto.sessions ? this.validateSessions(dto.sessions) : null

    await this.prisma.$transaction(async tx => {
      await tx.competition.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          description: dto.description !== undefined ? dto.description.trim() || null : undefined,
          matchFormat: dto.matchFormat,
          entryFeeCents: dto.entryFeeCents,
          status: dto.status,
        },
      })
      if (courts) {
        await tx.competitionCourt.deleteMany({ where: { competitionId: id, clubId } })
        await tx.competitionCourt.createMany({ data: courts.map(c => ({ clubId, competitionId: id, courtId: c.id })) })
      }
      if (sessions) {
        await tx.competitionSession.deleteMany({ where: { competitionId: id, clubId } })
        await tx.competitionSession.createMany({ data: sessions.map(s => ({ clubId, competitionId: id, ...s })) })
      }
      if (courts || sessions) {
        const finalCourts = courts ?? (await this.loadCompetitionCourts(tx, clubId, id))
        const finalSessions =
          sessions ?? (await tx.competitionSession.findMany({ where: { competitionId: id, clubId } }))
        await this.syncBlocks(tx, clubId, id, finalCourts, finalSessions)
      }
    })

    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  /** Cancels the event and gives its turnos back. Registrations and results are kept. */
  async cancel(clubId: string, id: string) {
    const current = await this.loadCompetition(clubId, id)
    this.assertNotCancelled(current.status)
    await this.prisma.$transaction(async tx => {
      await this.releaseBlocks(tx, clubId, id)
      await tx.competition.update({ where: { id }, data: { status: CompetitionStatus.CANCELLED } })
    })
    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  async remove(clubId: string, id: string): Promise<void> {
    await this.loadCompetition(clubId, id)
    await this.prisma.$transaction(async tx => {
      // Free the turnos first: deleting the event would only null their link and leave them BLOCKED.
      await this.releaseBlocks(tx, clubId, id)
      await tx.competition.delete({ where: { id } })
    })
    this.emitChanged(clubId, id)
  }

  // ─── Categories ──────────────────────────────────────────────────────────────

  async addCategory(clubId: string, id: string, dto: CreateCategoryDto) {
    const competition = await this.loadCompetition(clubId, id)
    this.assertNotCancelled(competition.status)
    if (competition.kind === CompetitionKind.PENA) throw new BadRequestException('Una peña tiene una sola categoría')
    this.assertCategoryShape(dto)
    await this.prisma.competitionCategory.create({ data: { clubId, competitionId: id, ...this.categoryData(dto) } })
    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  async updateCategory(clubId: string, id: string, categoryId: string, dto: UpdateCategoryDto) {
    const category = await this.loadCategory(clubId, id, categoryId)
    if (category.fixtureGeneratedAt) {
      throw new ConflictException('El fixture de esta categoría ya está armado: borralo para cambiarla')
    }
    const merged = {
      name: dto.name ?? category.name,
      format: dto.format ?? category.format,
      groupSize: dto.groupSize ?? category.groupSize,
      advancePerGroup: dto.advancePerGroup ?? category.advancePerGroup,
      maxPairs: dto.maxPairs !== undefined ? dto.maxPairs : category.maxPairs,
    }
    this.assertCategoryShape(merged)
    if (merged.maxPairs !== null && merged.maxPairs < category._count.pairs) {
      throw new BadRequestException(`Ya hay ${category._count.pairs} parejas anotadas en esta categoría`)
    }
    await this.prisma.competitionCategory.update({
      where: { id: categoryId },
      data: { ...merged, name: merged.name.trim() },
    })
    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  async removeCategory(clubId: string, id: string, categoryId: string) {
    const category = await this.loadCategory(clubId, id, categoryId)
    if (category.competition.kind === CompetitionKind.PENA) {
      throw new BadRequestException('Una peña tiene una sola categoría')
    }
    if (category._count.pairs > 0) {
      throw new ConflictException('La categoría tiene parejas anotadas: borralas o pasalas a otra primero')
    }
    await this.prisma.competitionCategory.delete({ where: { id: categoryId } })
    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  // ─── Pairs ───────────────────────────────────────────────────────────────────

  async addPair(clubId: string, id: string, dto: CreatePairDto) {
    const competition = await this.loadCompetition(clubId, id)
    this.assertOpenForChanges(competition.status)
    const categoryId = await this.resolveCategoryId(clubId, id, dto.categoryId)
    const category = await this.loadCategory(clubId, id, categoryId)
    this.assertCategoryTakesPairs(category)

    const players = await this.preparePlayers(clubId, dto.players)
    await this.prisma.competitionPair.create({
      data: {
        clubId,
        competitionId: id,
        categoryId,
        seed: dto.seed ?? null,
        players: { create: players.map(p => ({ clubId, competitionId: id, ...p })) },
      },
    })
    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  async updatePair(clubId: string, id: string, pairId: string, dto: UpdatePairDto) {
    const competition = await this.loadCompetition(clubId, id)
    this.assertOpenForChanges(competition.status)
    const pair = await this.loadPair(clubId, id, pairId)

    if (dto.categoryId && dto.categoryId !== pair.categoryId) {
      const from = await this.loadCategory(clubId, id, pair.categoryId)
      if (from.fixtureGeneratedAt) {
        throw new ConflictException('El fixture de su categoría ya está armado: no se puede mover la pareja')
      }
      this.assertCategoryTakesPairs(await this.loadCategory(clubId, id, dto.categoryId))
    }

    const players = dto.players ? await this.preparePlayers(clubId, dto.players) : null
    await this.prisma.$transaction(async tx => {
      await tx.competitionPair.update({
        where: { id: pairId },
        data: { categoryId: dto.categoryId, seed: dto.seed },
      })
      for (const p of players ?? []) {
        await tx.competitionPlayer.update({
          where: { pairId_position: { pairId, position: p.position } },
          data: { name: p.name, phone: p.phone, playerId: p.playerId },
        })
      }
    })
    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  async removePair(clubId: string, id: string, pairId: string) {
    const pair = await this.loadPair(clubId, id, pairId)
    const category = await this.loadCategory(clubId, id, pair.categoryId)
    if (category.fixtureGeneratedAt) {
      throw new ConflictException('El fixture de su categoría ya está armado: borralo para sacar la pareja')
    }
    await this.prisma.competitionPair.delete({ where: { id: pairId } })
    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  /** Marks one player's registration fee as paid (with how) or back to pending. */
  async setPlayerPayment(clubId: string, id: string, competitionPlayerId: string, dto: UpdatePlayerPaymentDto) {
    const player = await this.prisma.competitionPlayer.findFirst({
      where: { id: competitionPlayerId, competitionId: id, clubId },
      select: { id: true },
    })
    if (!player) throw new NotFoundException('Jugador no encontrado')
    await this.prisma.competitionPlayer.update({
      where: { id: competitionPlayerId },
      data: dto.paid
        ? { paidAt: new Date(), paymentMethod: dto.method ?? PlayerPaymentMethod.CASH }
        : { paidAt: null, paymentMethod: null },
    })
    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  // ─── Fixture ─────────────────────────────────────────────────────────────────

  /**
   * Draws the category's fixture from its pairs (seed first, then registration order):
   * everyone-vs-everyone in waves over the event's courts, zonas with their matches, or a
   * straight bracket.
   */
  async generateFixture(clubId: string, id: string, categoryId: string) {
    const competition = await this.loadCompetition(clubId, id)
    this.assertOpenForChanges(competition.status)
    const category = await this.loadCategory(clubId, id, categoryId)
    if (category.fixtureGeneratedAt) throw new ConflictException('El fixture de esta categoría ya está armado')

    const pairs = await this.seededPairs(clubId, categoryId)
    if (pairs.length < 2) throw new BadRequestException('Hacen falta al menos 2 parejas para armar el fixture')

    if (category.format === CategoryFormat.GROUPS_KNOCKOUT) {
      const groupCount = splitIntoGroups(pairs, category.groupSize).length
      if (groupCount * Math.min(category.advancePerGroup, category.groupSize) < 2) {
        throw new BadRequestException('Con una sola zona tienen que pasar al menos 2 parejas al cuadro')
      }
    }

    await this.prisma.$transaction(async tx => {
      if (category.format === CategoryFormat.ROUND_ROBIN) {
        const courts = await this.loadCompetitionCourts(tx, clubId, id)
        const pairings = roundRobinPairings(pairs.length)
        const placed =
          courts.length > 0
            ? packIntoWaves(pairings, courts.length).map(p => ({
                ...p,
                round: p.wave,
                courtId: courts[p.courtIndex].id,
              }))
            : pairings.map(p => ({ ...p, courtId: null as string | null }))
        const positions = new Map<number, number>()
        await tx.competitionMatch.createMany({
          data: placed.map(p => {
            const position = positions.get(p.round) ?? 0
            positions.set(p.round, position + 1)
            return {
              clubId,
              competitionId: id,
              categoryId,
              stage: MatchStage.GROUP,
              round: p.round,
              position,
              pairAId: pairs[p.a].id,
              pairBId: pairs[p.b].id,
              courtId: p.courtId,
            }
          }),
        })
      } else if (category.format === CategoryFormat.GROUPS_KNOCKOUT) {
        const groups = splitIntoGroups(pairs, category.groupSize)
        for (const [index, members] of groups.entries()) {
          const group = await tx.competitionGroup.create({
            data: { clubId, competitionId: id, categoryId, name: groupName(index), position: index },
            select: { id: true },
          })
          await tx.competitionPair.updateMany({
            where: { id: { in: members.map(m => m.id) }, clubId },
            data: { groupId: group.id },
          })
          const positions = new Map<number, number>()
          await tx.competitionMatch.createMany({
            data: roundRobinPairings(members.length).map(p => {
              const position = positions.get(p.round) ?? 0
              positions.set(p.round, position + 1)
              return {
                clubId,
                competitionId: id,
                categoryId,
                stage: MatchStage.GROUP,
                groupId: group.id,
                round: p.round,
                position,
                pairAId: members[p.a].id,
                pairBId: members[p.b].id,
              }
            }),
          })
        }
      } else {
        await this.createBracket(
          tx,
          clubId,
          id,
          categoryId,
          pairs.map(p => ({ pairId: p.id, label: pairLabel(p) })),
        )
      }

      await tx.competitionCategory.update({
        where: { id: categoryId },
        data: {
          fixtureGeneratedAt: new Date(),
          ...(category.format === CategoryFormat.KNOCKOUT ? { bracketGeneratedAt: new Date() } : {}),
        },
      })
      if (competition.status === CompetitionStatus.OPEN) {
        await tx.competition.update({ where: { id }, data: { status: CompetitionStatus.IN_PROGRESS } })
      }
    })

    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  /** Undoes the fixture (zonas, matches and bracket) while no result has been loaded. */
  async deleteFixture(clubId: string, id: string, categoryId: string) {
    const competition = await this.loadCompetition(clubId, id)
    this.assertNotCancelled(competition.status)
    await this.loadCategory(clubId, id, categoryId)
    await this.assertNoResults(clubId, { categoryId })

    await this.prisma.$transaction(async tx => {
      await tx.competitionMatch.deleteMany({ where: { categoryId, clubId } })
      await tx.competitionPair.updateMany({ where: { categoryId, clubId }, data: { groupId: null } })
      await tx.competitionGroup.deleteMany({ where: { categoryId, clubId } })
      await tx.competitionCategory.update({
        where: { id: categoryId },
        data: { fixtureGeneratedAt: null, bracketGeneratedAt: null },
      })
      const stillDrawn = await tx.competitionCategory.count({
        where: { competitionId: id, clubId, fixtureGeneratedAt: { not: null } },
      })
      if (stillDrawn === 0 && competition.status === CompetitionStatus.IN_PROGRESS) {
        await tx.competition.update({ where: { id }, data: { status: CompetitionStatus.OPEN } })
      }
    })

    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  /** Seeds the bracket from the zonas' final tables: 1° of each zona, then 2°, … */
  async generateBracket(clubId: string, id: string, categoryId: string) {
    const competition = await this.loadCompetition(clubId, id)
    this.assertOpenForChanges(competition.status)
    const category = await this.loadCategory(clubId, id, categoryId)
    if (category.format !== CategoryFormat.GROUPS_KNOCKOUT) {
      throw new BadRequestException('Esta categoría no tiene zonas')
    }
    if (!category.fixtureGeneratedAt) throw new ConflictException('Primero armá las zonas')
    if (category.bracketGeneratedAt) throw new ConflictException('El cuadro de esta categoría ya está armado')

    const groupMatches = await this.prisma.competitionMatch.findMany({
      where: { categoryId, clubId, stage: MatchStage.GROUP },
      select: { groupId: true, pairAId: true, pairBId: true, sets: true, winnerPairId: true },
    })
    const pending = groupMatches.filter(m => !m.winnerPairId).length
    if (pending > 0) {
      throw new ConflictException(
        pending === 1 ? 'Falta 1 resultado de las zonas' : `Faltan ${pending} resultados de las zonas`,
      )
    }

    const groups = await this.prisma.competitionGroup.findMany({
      where: { categoryId, clubId },
      select: { id: true, name: true },
      orderBy: { position: 'asc' },
    })
    const pairs = await this.seededPairs(clubId, categoryId)
    const tables = groups.map(group =>
      computeStandings(
        pairs.filter(p => p.groupId === group.id).map(p => p.id),
        groupMatches.filter(m => m.groupId === group.id).map(m => ({ ...m, sets: m.sets as SetScore[] | null })),
      ),
    )

    const entrants: BracketEntrant[] = []
    for (let place = 0; place < category.advancePerGroup; place++) {
      groups.forEach((group, g) => {
        const row = tables[g][place]
        if (row) entrants.push({ pairId: row.pairId, label: `${place + 1}° ${group.name}`, group: group.id })
      })
    }

    await this.prisma.$transaction(async tx => {
      await this.createBracket(tx, clubId, id, categoryId, entrants)
      await tx.competitionCategory.update({ where: { id: categoryId }, data: { bracketGeneratedAt: new Date() } })
    })

    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  /** Undoes the bracket of a zonas category (the zonas stay) while it has no results. */
  async deleteBracket(clubId: string, id: string, categoryId: string) {
    const competition = await this.loadCompetition(clubId, id)
    this.assertNotCancelled(competition.status)
    const category = await this.loadCategory(clubId, id, categoryId)
    if (category.format !== CategoryFormat.GROUPS_KNOCKOUT) {
      throw new BadRequestException('En esta categoría el cuadro es el fixture: borrá el fixture')
    }
    await this.assertNoResults(clubId, { categoryId, stage: MatchStage.KNOCKOUT })
    await this.prisma.$transaction(async tx => {
      await tx.competitionMatch.deleteMany({ where: { categoryId, clubId, stage: MatchStage.KNOCKOUT } })
      await tx.competitionCategory.update({ where: { id: categoryId }, data: { bracketGeneratedAt: null } })
    })
    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  // ─── Matches ─────────────────────────────────────────────────────────────────

  /** Loads (or clears) a result and/or sets the court and time. A knockout winner moves on. */
  async updateMatch(clubId: string, id: string, matchId: string, dto: UpdateMatchDto) {
    const competition = await this.loadCompetition(clubId, id)
    this.assertOpenForChanges(competition.status)
    const match = await this.prisma.competitionMatch.findFirst({
      where: { id: matchId, competitionId: id, clubId },
      select: {
        ...matchSelect,
        category: { select: { bracketGeneratedAt: true, format: true } },
        nextMatch: { select: { id: true, winnerPairId: true } },
      },
    })
    if (!match) throw new NotFoundException('Partido no encontrado')

    if (dto.courtId) await this.loadCourts(clubId, [dto.courtId])

    const data: Prisma.CompetitionMatchUncheckedUpdateInput = {}
    if (dto.courtId !== undefined) data.courtId = dto.courtId
    if (dto.startsAt !== undefined) data.startsAt = dto.startsAt ? new Date(dto.startsAt) : null

    let winnerPairId: string | null | undefined
    if (dto.sets !== undefined) {
      if (
        match.stage === MatchStage.GROUP &&
        match.category.format === CategoryFormat.GROUPS_KNOCKOUT &&
        match.category.bracketGeneratedAt
      ) {
        throw new ConflictException('El cuadro ya está armado: borralo para cambiar resultados de las zonas')
      }
      if (dto.sets === null) {
        winnerPairId = null
      } else {
        if (!match.pairAId || !match.pairBId) {
          throw new BadRequestException('Todavía no se sabe quién juega este partido')
        }
        let winner: 'A' | 'B'
        try {
          winner = evaluateScore(dto.sets as SetScore[], competition.matchFormat).winner
        } catch (error) {
          throw new BadRequestException(error instanceof Error ? error.message : 'Resultado inválido')
        }
        winnerPairId = winner === 'A' ? match.pairAId : match.pairBId
      }
      if (match.nextMatch?.winnerPairId && winnerPairId !== match.winnerPairId) {
        throw new ConflictException('El partido siguiente ya tiene resultado: borralo primero')
      }
      data.sets = dto.sets === null ? Prisma.DbNull : (dto.sets as Prisma.InputJsonValue)
      data.winnerPairId = winnerPairId
    }

    await this.prisma.$transaction(async tx => {
      await tx.competitionMatch.update({ where: { id: matchId }, data })
      if (winnerPairId !== undefined && match.nextMatchId && match.nextSlot) {
        await tx.competitionMatch.update({
          where: { id: match.nextMatchId },
          data: match.nextSlot === 'A' ? { pairAId: winnerPairId } : { pairBId: winnerPairId },
        })
      }
    })

    this.emitChanged(clubId, id)
    return this.findOne(clubId, id)
  }

  // ─── Court blocking ──────────────────────────────────────────────────────────

  /**
   * Makes the event's BLOCKED turnos match its courts × sessions: blocks every band of the grid
   * that overlaps a session (creating the slot or flipping an AVAILABLE one), and frees the ones
   * it held that no longer apply. A band blocked for something else is left alone and not
   * claimed. Any booked turno in the way refuses the whole change, listing them, so the club
   * never ends up with half an event on the courts.
   */
  private async syncBlocks(
    tx: Tx,
    clubId: string,
    competitionId: string,
    courts: (CourtSchedule & { id: string; name: string; priceCents: number })[],
    sessions: SessionTimes[],
  ): Promise<void> {
    const windows = sessions.map(s => sessionWindow(s))
    const targets = new Map<string, TimeWindow & { court: (typeof courts)[number] }>()
    for (const court of courts) {
      for (const window of windows) {
        for (const band of bandsOverlapping(court, window)) {
          targets.set(`${court.id}|${band.startsAt.getTime()}`, { ...band, court })
        }
      }
    }

    const all = [...targets.values()]
    const existing = all.length
      ? await tx.slot.findMany({
          where: {
            clubId,
            courtId: { in: courts.map(c => c.id) },
            startsAt: { lt: new Date(Math.max(...all.map(t => t.endsAt.getTime()))) },
            endsAt: { gt: new Date(Math.min(...all.map(t => t.startsAt.getTime()))) },
          },
          select: { id: true, courtId: true, startsAt: true, endsAt: true, status: true, competitionId: true },
        })
      : []

    const conflicts: string[] = []
    const toCreate: Prisma.SlotCreateManyInput[] = []
    const toClaim: string[] = []
    const keep = new Set<string>()
    for (const target of all) {
      const overlapping = existing.filter(
        s => s.courtId === target.court.id && s.startsAt < target.endsAt && s.endsAt > target.startsAt,
      )
      const booked = overlapping.find(s => s.status === SlotStatus.BOOKED)
      if (booked) {
        conflicts.push(
          `${target.court.name} · ${dayLabelFromKey(toDateKey(booked.startsAt))} ${formatTime(booked.startsAt)}`,
        )
        continue
      }
      const exact = overlapping.find(s => s.startsAt.getTime() === target.startsAt.getTime())
      if (!exact) {
        toCreate.push({
          clubId,
          courtId: target.court.id,
          startsAt: target.startsAt,
          endsAt: target.endsAt,
          priceCents: target.court.priceCents,
          status: SlotStatus.BLOCKED,
          competitionId,
        })
      } else if (exact.competitionId === competitionId && exact.status === SlotStatus.BLOCKED) {
        keep.add(exact.id)
      } else if (exact.status === SlotStatus.AVAILABLE) {
        toClaim.push(exact.id)
      }
    }

    if (conflicts.length > 0) {
      const unique = [...new Set(conflicts)]
      const listed = unique.slice(0, MAX_CONFLICTS_LISTED).join(', ')
      const more = unique.length > MAX_CONFLICTS_LISTED ? ` y ${unique.length - MAX_CONFLICTS_LISTED} más` : ''
      throw new ConflictException(
        `Hay turnos reservados en ese horario: ${listed}${more}. Movelos o cancelalos y volvé a intentar.`,
      )
    }

    await tx.slot.updateMany({
      where: { clubId, competitionId, id: { notIn: [...keep] } },
      data: { status: SlotStatus.AVAILABLE, competitionId: null },
    })
    if (toClaim.length > 0) {
      const { count } = await tx.slot.updateMany({
        where: { id: { in: toClaim }, clubId, status: SlotStatus.AVAILABLE },
        data: { status: SlotStatus.BLOCKED, competitionId },
      })
      if (count !== toClaim.length) throw new ConflictException('Se reservó un turno recién: volvé a intentar')
    }
    if (toCreate.length > 0) {
      try {
        await tx.slot.createMany({ data: toCreate })
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException('Se reservó un turno recién: volvé a intentar')
        throw error
      }
    }
  }

  private async releaseBlocks(tx: Tx, clubId: string, competitionId: string): Promise<void> {
    await tx.slot.updateMany({
      where: { clubId, competitionId },
      data: { status: SlotStatus.AVAILABLE, competitionId: null },
    })
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async createBracket(
    tx: Tx,
    clubId: string,
    competitionId: string,
    categoryId: string,
    entrants: BracketEntrant[],
  ): Promise<void> {
    let bracket
    try {
      bracket = buildBracket(entrants)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'No se pudo armar el cuadro')
    }

    // Create from the final backwards so every match already knows the id of the next one.
    const ids = new Map<string, string>()
    const byRoundDesc = [...bracket].sort((x, y) => y.round - x.round || x.position - y.position)
    for (const m of byRoundDesc) {
      const nextId = m.next ? ids.get(`${m.round + 1}|${m.next.position}`) : undefined
      const created = await tx.competitionMatch.create({
        data: {
          clubId,
          competitionId,
          categoryId,
          stage: MatchStage.KNOCKOUT,
          round: m.round,
          position: m.position,
          pairAId: m.a?.pairId ?? null,
          pairBId: m.b?.pairId ?? null,
          placeholderA: m.round === 1 ? (m.a?.label ?? 'Libre') : null,
          placeholderB: m.round === 1 ? (m.b?.label ?? 'Libre') : null,
          nextMatchId: nextId ?? null,
          nextSlot: m.next?.slot ?? null,
        },
        select: { id: true },
      })
      ids.set(`${m.round}|${m.position}`, created.id)
    }

    // A bye: the lone pair goes straight on to the next round.
    for (const m of bracket.filter(b => b.round === 1 && (!b.a || !b.b))) {
      const lone = m.a ?? m.b
      if (!lone || !m.next) continue
      await tx.competitionMatch.update({
        where: { id: ids.get(`1|${m.position}`) },
        data: { winnerPairId: lone.pairId },
      })
      await tx.competitionMatch.update({
        where: { id: ids.get(`2|${m.next.position}`) },
        data: m.next.slot === 'A' ? { pairAId: lone.pairId } : { pairBId: lone.pairId },
      })
    }
  }

  private present(row: DetailRow) {
    const { courts, categories, pairs, matches, ...rest } = row
    const playersAll = pairs.flatMap(p => p.players)
    const pairIdsBySeed = (list: PairRow[]) => sortBySeed(list).map(p => p.id)
    const resultOf = (m: DetailRow['matches'][number]) => ({ ...m, sets: m.sets as SetScore[] | null })

    return {
      ...rest,
      courts: courts.map(c => c.court),
      categories: categories.map(category => {
        const categoryPairs = pairs.filter(p => p.categoryId === category.id)
        const categoryMatches = matches.filter(m => m.categoryId === category.id).map(resultOf)
        const standings: StandingRow[] | null =
          category.format === CategoryFormat.ROUND_ROBIN && category.fixtureGeneratedAt
            ? computeStandings(pairIdsBySeed(categoryPairs), categoryMatches)
            : null
        return {
          ...category,
          standings,
          groups: category.groups.map(group => ({
            ...group,
            standings: computeStandings(
              pairIdsBySeed(categoryPairs.filter(p => p.groupId === group.id)),
              categoryMatches.filter(m => m.groupId === group.id),
            ),
          })),
        }
      }),
      pairs,
      matches: matches.map(resultOf),
      fees: {
        expectedCents: rest.entryFeeCents * playersAll.length,
        collectedCents: rest.entryFeeCents * playersAll.filter(p => p.paidAt).length,
      },
    }
  }

  private emitChanged(clubId: string, competitionId: string): void {
    this.events.emitCompetitionChanged({ type: 'competition.changed', clubId, competitionId })
  }

  private async loadCompetition(clubId: string, id: string) {
    const competition = await this.prisma.competition.findFirst({
      where: { id, clubId },
      select: { id: true, kind: true, status: true, matchFormat: true },
    })
    if (!competition) throw new NotFoundException('Evento no encontrado')
    return competition
  }

  private async loadCategory(clubId: string, competitionId: string, categoryId: string) {
    const category = await this.prisma.competitionCategory.findFirst({
      where: { id: categoryId, competitionId, clubId },
      select: {
        id: true,
        name: true,
        format: true,
        groupSize: true,
        advancePerGroup: true,
        maxPairs: true,
        fixtureGeneratedAt: true,
        bracketGeneratedAt: true,
        competition: { select: { kind: true } },
        _count: { select: { pairs: true } },
      },
    })
    if (!category) throw new NotFoundException('Categoría no encontrada')
    return category
  }

  private async loadPair(clubId: string, competitionId: string, pairId: string) {
    const pair = await this.prisma.competitionPair.findFirst({
      where: { id: pairId, competitionId, clubId },
      select: { id: true, categoryId: true },
    })
    if (!pair) throw new NotFoundException('Pareja no encontrada')
    return pair
  }

  /** The category a new pair goes to: the one given, or the only one there is. */
  private async resolveCategoryId(clubId: string, competitionId: string, categoryId?: string): Promise<string> {
    if (categoryId) return categoryId
    const categories = await this.prisma.competitionCategory.findMany({
      where: { competitionId, clubId },
      select: { id: true },
      take: 2,
    })
    if (categories.length !== 1) throw new BadRequestException('Elegí la categoría de la pareja')
    return categories[0].id
  }

  private assertCategoryTakesPairs(category: Awaited<ReturnType<CompetitionsService['loadCategory']>>): void {
    if (category.fixtureGeneratedAt) {
      throw new ConflictException(`El fixture de ${category.name} ya está armado: borralo para sumar parejas`)
    }
    if (category.maxPairs !== null && category._count.pairs >= category.maxPairs) {
      throw new ConflictException(`${category.name} ya tiene el cupo completo (${category.maxPairs} parejas)`)
    }
  }

  /** Normalizes the two players and links each phone to the club's Player list. */
  private async preparePlayers(clubId: string, players: PairPlayerDto[]) {
    return Promise.all(
      players.map(async (p, i) => {
        const phone = p.phone ? normalizePhone(p.phone) : ''
        const name = p.name.trim()
        return {
          position: i + 1,
          name,
          phone: phone || null,
          playerId: phone ? await this.players.upsertForBooking(clubId, phone, { name }) : null,
        }
      }),
    )
  }

  private async seededPairs(clubId: string, categoryId: string) {
    const pairs = await this.prisma.competitionPair.findMany({
      where: { categoryId, clubId },
      select: pairSelect,
      orderBy: { createdAt: 'asc' },
    })
    return sortBySeed(pairs)
  }

  private async loadCourts(clubId: string, courtIds: string[]) {
    const ids = [...new Set(courtIds)]
    const courts = await this.prisma.court.findMany({
      where: { clubId, id: { in: ids } },
      select: { id: true, name: true, priceCents: true, ...courtScheduleSelect },
      orderBy: { name: 'asc' },
    })
    if (courts.length !== ids.length) throw new BadRequestException('Una o más canchas no pertenecen a este complejo')
    return courts
  }

  private async loadCompetitionCourts(tx: Tx, clubId: string, competitionId: string) {
    const rows = await tx.competitionCourt.findMany({
      where: { competitionId, clubId },
      select: { court: { select: { id: true, name: true, priceCents: true, ...courtScheduleSelect } } },
    })
    return rows.map(r => r.court).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
  }

  /** Checks every session's times and that no two of them overlap. */
  private validateSessions(sessions: SessionTimes[]): SessionTimes[] {
    const windows = sessions.map(s => {
      try {
        return { session: s, window: sessionWindow(s) }
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Horario inválido')
      }
    })
    windows.sort((a, b) => a.window.startsAt.getTime() - b.window.startsAt.getTime())
    for (let i = 1; i < windows.length; i++) {
      if (windows[i].window.startsAt < windows[i - 1].window.endsAt) {
        throw new BadRequestException('Dos franjas del evento se superponen')
      }
    }
    return windows.map(w => ({
      dateKey: w.session.dateKey,
      startTime: w.session.startTime,
      endTime: w.session.endTime,
    }))
  }

  private categoryData(dto: CreateCategoryDto) {
    return {
      name: dto.name.trim(),
      format: dto.format,
      groupSize: dto.groupSize ?? 3,
      advancePerGroup: dto.advancePerGroup ?? 2,
      maxPairs: dto.maxPairs ?? null,
    }
  }

  private assertCategoryShape(dto: Pick<CreateCategoryDto, 'format' | 'groupSize' | 'advancePerGroup'>): void {
    if (dto.format === CategoryFormat.GROUPS_KNOCKOUT && (dto.advancePerGroup ?? 2) > (dto.groupSize ?? 3)) {
      throw new BadRequestException('No pueden pasar más parejas que las que tiene cada zona')
    }
  }

  private async assertNoResults(clubId: string, where: { categoryId: string; stage?: MatchStage }): Promise<void> {
    const played = await this.prisma.competitionMatch.count({
      where: { ...where, clubId, sets: { not: Prisma.DbNull } },
    })
    if (played > 0) throw new ConflictException('Ya hay resultados cargados: borralos primero')
  }

  private assertNotCancelled(status: CompetitionStatus): void {
    if (status === CompetitionStatus.CANCELLED) throw new ConflictException('El evento está cancelado')
  }

  private assertOpenForChanges(status: CompetitionStatus): void {
    this.assertNotCancelled(status)
    if (status === CompetitionStatus.FINISHED) {
      throw new ConflictException('El evento está finalizado: reabrilo para hacer cambios')
    }
  }
}

function sortBySeed<T extends { seed: number | null; createdAt: Date }>(pairs: T[]): T[] {
  return [...pairs].sort(
    (a, b) =>
      (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  )
}

function pairLabel(pair: { players: { name: string }[] }): string {
  return pair.players.map(p => p.name).join(' / ')
}

import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { formatTime, toDateKey, weekdayOfKey } from '../availability/lib/datetime'
import { QueryPlayersDto } from './dto/query-players.dto'
import { UpdatePlayerDto } from './dto/update-player.dto'

const playerSelect = {
  id: true,
  phone: true,
  name: true,
  dni: true,
  noShowCount: true,
  creditCents: true,
  isBlocked: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Digits-only phone, matching the WhatsApp wa_id format bookings already use. */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds or creates the club's Player for a phone and refreshes name/DNI with the
   * newest non-empty values. Called on every booking that carries a phone, so the
   * CRM stays current without anyone maintaining it. Returns the player id (to link
   * on the Booking) or null when the phone is unusable.
   */
  async upsertForBooking(
    clubId: string,
    phone: string | null | undefined,
    data: { name?: string | null; dni?: string | null } = {},
  ): Promise<string | null> {
    const normalized = phone ? normalizePhone(phone) : ''
    if (normalized.length < 6) return null

    const player = await this.prisma.player.upsert({
      where: { clubId_phone: { clubId, phone: normalized } },
      create: {
        clubId,
        phone: normalized,
        name: data.name?.trim() || null,
        dni: data.dni || null,
      },
      update: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.dni ? { dni: data.dni } : {}),
      },
      select: { id: true },
    })
    return player.id
  }

  /** The player's booking-relevant standing, for deposit policy and the bot guard. */
  async standingForPhone(
    clubId: string,
    phone: string | null | undefined,
  ): Promise<{ id: string; isBlocked: boolean; noShowCount: number; creditCents: number } | null> {
    const normalized = phone ? normalizePhone(phone) : ''
    if (normalized.length < 6) return null
    return this.prisma.player.findUnique({
      where: { clubId_phone: { clubId, phone: normalized } },
      select: { id: true, isBlocked: true, noShowCount: true, creditCents: true },
    })
  }

  /**
   * The player's habitual slot ("lo de siempre"): among their last confirmed
   * bookings, the (weekday, start time, court) they repeat the most — if repeated
   * at least twice. Powers the bot's 3-tap re-booking for regulars.
   */
  async habitualBooking(
    clubId: string,
    phone: string,
  ): Promise<{ weekday: number; bandStart: string; courtId: string; courtName: string; count: number } | null> {
    const normalized = normalizePhone(phone)
    if (normalized.length < 6) return null

    const bookings = await this.prisma.booking.findMany({
      where: { clubId, status: 'CONFIRMED', player: { phone: normalized } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { slot: { select: { startsAt: true, court: { select: { id: true, name: true } } } } },
    })
    if (bookings.length < 2) return null

    const groups = new Map<
      string,
      { weekday: number; bandStart: string; courtId: string; courtName: string; count: number }
    >()
    for (const b of bookings) {
      const weekday = weekdayOfKey(toDateKey(b.slot.startsAt))
      const bandStart = formatTime(b.slot.startsAt)
      const key = `${weekday}|${bandStart}|${b.slot.court.id}`
      const entry = groups.get(key) ?? {
        weekday,
        bandStart,
        courtId: b.slot.court.id,
        courtName: b.slot.court.name,
        count: 0,
      }
      entry.count++
      groups.set(key, entry)
    }

    const best = [...groups.values()].sort((a, b) => b.count - a.count)[0]
    return best && best.count >= 2 ? best : null
  }

  async findAll(clubId: string, query: QueryPlayersDto) {
    const search = query.search?.trim()
    const players = await this.prisma.player.findMany({
      where: {
        clubId,
        ...(search
          ? {
              OR: [{ name: { contains: search } }, { phone: { contains: normalizePhone(search) || search } }],
            }
          : {}),
      },
      select: {
        ...playerSelect,
        _count: { select: { bookings: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    return players.map(({ _count, ...player }) => ({ ...player, bookingsCount: _count.bookings }))
  }

  /** Player file: profile + recent bookings (court + times) for the panel. */
  async findOne(clubId: string, id: string) {
    const player = await this.prisma.player.findFirst({
      where: { id, clubId },
      select: {
        ...playerSelect,
        bookings: {
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: {
            id: true,
            status: true,
            noShowAt: true,
            depositCents: true,
            createdAt: true,
            slot: { select: { startsAt: true, endsAt: true, court: { select: { name: true } } } },
          },
        },
      },
    })
    if (!player) throw new NotFoundException('Jugador no encontrado')
    return player
  }

  async update(clubId: string, id: string, dto: UpdatePlayerDto) {
    const existing = await this.prisma.player.findFirst({ where: { id, clubId }, select: { id: true } })
    if (!existing) throw new NotFoundException('Jugador no encontrado')
    return this.prisma.player.update({
      where: { id },
      data: { name: dto.name, isBlocked: dto.isBlocked, notes: dto.notes },
      select: playerSelect,
    })
  }
}

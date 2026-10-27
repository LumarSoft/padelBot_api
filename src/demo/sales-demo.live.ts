import { PrismaClient } from '../../generated/prisma/client'
import { bandDateTimes, bandsForDate, ScheduleBand } from '../availability/lib/schedule'
import { resolveBandPriceCents } from '../availability/lib/pricing'
import { formatTimeRange, shiftDateKey, toDateKey, wallTimeToUtc } from '../availability/lib/datetime'
import { BandOption } from '../bot/types'
import { bookingConversation, sessionContextFor } from './lib/booking-conversation'
import { DEMO_PHONE_PREFIX, SALES_DEMO_SLUG } from './sales-demo.seed'

/**
 * Keeps the sales demo alive between nightly rebuilds, so it is ready for a visit at any hour
 * without anyone refreshing it: during the day a "player" books through the bot every 15–25
 * minutes (chat + pending seña with a live countdown in Pagos), and 16–24 minutes later the
 * transfer "arrives" and the booking confirms — before the real 30-minute expiry ever fires.
 *
 * It only ever touches bookings of demo players (DEMO_PHONE_PREFIX, numbers that don't exist),
 * so whatever a prospect books for real through the club's WhatsApp is left alone.
 */

const MINUTE = 60_000
/** Club-local hours when new demo bookings arrive (confirmations run around the clock). */
const ACTIVE_FROM = '08:00'
const ACTIVE_UNTIL = '23:30'
/** How many demo señas wait for their transfer at once. */
const LIVE_PENDING_TARGET = 2

export interface SalesDemoTick {
  confirmed: number
  created: boolean
}

/** Stable pseudo-random integer in [min, max] derived from an id (no state between ticks). */
function fromId(id: string, min: number, max: number): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return min + (Math.abs(hash) % (max - min + 1))
}

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]

function weightedPick<T>(items: Array<{ item: T; weight: number }>): T | null {
  const total = items.reduce((sum, i) => sum + i.weight, 0)
  if (total <= 0) return null
  let r = Math.random() * total
  for (const i of items) {
    r -= i.weight
    if (r <= 0) return i.item
  }
  return items[items.length - 1].item
}

export async function tickSalesDemo(prisma: PrismaClient, now = new Date()): Promise<SalesDemoTick> {
  const club = await prisma.club.findUnique({
    where: { slug: SALES_DEMO_SLUG },
    select: {
      id: true,
      transferAlias: true,
      transferHolder: true,
      botWelcomeExtra: true,
      depositMode: true,
      depositPercent: true,
      paymentVerificationMode: true,
    },
  })
  // The simulated "transfer detected" only makes sense while the club reconciles automatically.
  if (!club || club.paymentVerificationMode !== 'AUTO') return { confirmed: 0, created: false }

  const pendings = await prisma.booking.findMany({
    where: {
      clubId: club.id,
      status: 'PENDING_PAYMENT',
      bookedByUserId: null,
      transferAmountCents: { not: null },
      playerPhone: { startsWith: DEMO_PHONE_PREFIX },
    },
    select: {
      id: true,
      createdAt: true,
      paymentExpiresAt: true,
      player: { select: { id: true, dni: true, payerMpUserId: true } },
    },
  })

  // 1. The transfers that "arrived": confirm like the MercadoPago poller would.
  let confirmed = 0
  for (const pending of pendings) {
    if (now.getTime() < pending.createdAt.getTime() + fromId(pending.id, 16, 24) * MINUTE) continue
    const payerMpUserId = pending.player?.payerMpUserId ?? String(150_000_000 + fromId(pending.id, 0, 1_700_000_000))
    await prisma.booking.update({
      where: { id: pending.id },
      data: {
        status: 'CONFIRMED',
        mpPaymentId: `993${String(now.getTime()).slice(-7)}${fromId(pending.id, 10, 99)}`,
        payerCuit: pending.player?.dni ? `20-${pending.player.dni}-${fromId(pending.id, 0, 9)}` : null,
        payerMpUserId,
        // Demo phones don't exist: never let the reminder cron try to message them.
        reminderSentAt: now,
      },
    })
    if (pending.player && !pending.player.payerMpUserId) {
      await prisma.player.update({ where: { id: pending.player.id }, data: { payerMpUserId } })
    }
    confirmed += 1
  }

  // 2. A new player booking through the bot, if it's time for one.
  const created = await maybeCreatePending(prisma, club, now, pendings.length - confirmed)
  return { confirmed, created }
}

async function maybeCreatePending(
  prisma: PrismaClient,
  club: {
    id: string
    transferAlias: string | null
    transferHolder: string | null
    botWelcomeExtra: string | null
    depositMode: string
    depositPercent: number
  },
  now: Date,
  livePending: number,
): Promise<boolean> {
  const today = toDateKey(now)
  if (now < wallTimeToUtc(today, ACTIVE_FROM) || now > wallTimeToUtc(today, ACTIVE_UNTIL)) return false
  if (livePending >= LIVE_PENDING_TARGET || !club.transferAlias) return false

  const last = await prisma.booking.findFirst({
    where: {
      clubId: club.id,
      bookedByUserId: null,
      recurringBookingId: null,
      playerPhone: { startsWith: DEMO_PHONE_PREFIX },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  })
  if (last && now.getTime() < last.createdAt.getTime() + fromId(last.id, 15, 25) * MINUTE) return false

  // Who books: a demo player who isn't blocked and hasn't chatted in the last hours.
  const recentChats = await prisma.conversationSession.findMany({
    where: { clubId: club.id, updatedAt: { gte: new Date(now.getTime() - 6 * 60 * MINUTE) } },
    select: { waId: true },
  })
  const busy = new Set(recentChats.map(s => s.waId))
  const players = await prisma.player.findMany({
    where: { clubId: club.id, phone: { startsWith: DEMO_PHONE_PREFIX }, isBlocked: false, noShowCount: { lt: 3 } },
    select: { id: true, name: true, phone: true, dni: true, _count: { select: { bookings: true } } },
  })
  const candidates = players.filter(p => p.name && !busy.has(p.phone))
  if (candidates.length === 0) return false
  const player = pick(candidates)

  // When: a free band from later today to five days ahead, mostly evenings and soon.
  const courts = await prisma.court.findMany({
    where: { clubId: club.id },
    select: {
      id: true,
      name: true,
      priceCents: true,
      openTime: true,
      closeTime: true,
      slotDurationMinutes: true,
      weeklyHours: true,
      priceRules: true,
    },
  })
  const horizonEnd = new Date(now.getTime() + 7 * 24 * 60 * MINUTE)
  const taken = await prisma.slot.findMany({
    where: { clubId: club.id, startsAt: { gte: now, lt: horizonEnd }, status: { not: 'AVAILABLE' } },
    select: { courtId: true, startsAt: true },
  })
  const takenKeys = new Set(taken.map(s => `${s.courtId}|${s.startsAt.toISOString()}`))
  const options: Array<{
    item: { court: (typeof courts)[number]; dateKey: string; band: ScheduleBand }
    weight: number
  }> = []
  for (let offset = 0; offset <= 5; offset += 1) {
    const dateKey = shiftDateKey(today, offset)
    for (const court of courts) {
      for (const band of bandsForDate(court, dateKey)) {
        const { startsAt } = bandDateTimes(dateKey, band)
        if (startsAt.getTime() < now.getTime() + 90 * MINUTE) continue
        if (takenKeys.has(`${court.id}|${startsAt.toISOString()}`)) continue
        const evening = Number(band.start.slice(0, 2)) >= 17
        options.push({
          item: { court, dateKey, band },
          weight: (evening ? 3 : 1) * (offset <= 1 ? 3 : offset <= 3 ? 2 : 1),
        })
      }
    }
  }
  const choice = weightedPick(options)
  if (!choice) return false
  const { court, dateKey, band } = choice
  const { startsAt, endsAt } = bandDateTimes(dateKey, band)
  const priceCents = resolveBandPriceCents(court.priceCents, court.priceRules, dateKey, band.start)
  const depositCents = club.depositMode === 'FULL' ? priceCents : Math.ceil((priceCents * club.depositPercent) / 100)
  const transferAmountCents = Math.round(depositCents / 100) * 100
  const dni = player.dni ?? String(25_000_000 + Math.floor(Math.random() * 20_000_000))
  const known = player._count.bookings > 0

  // The chat that led to it, ending on the transfer data a few seconds ago.
  const freeBands: BandOption[] = []
  for (const c of courts) {
    for (const b of bandsForDate(c, dateKey)) {
      const at = bandDateTimes(dateKey, b)
      if (at.startsAt <= now) continue
      const isChosen = c.id === court.id && b.start === band.start
      if (!isChosen && takenKeys.has(`${c.id}|${at.startsAt.toISOString()}`)) continue
      const option = freeBands.find(o => o.bandStart === b.start) ?? {
        bandStart: b.start,
        label: formatTimeRange(at.startsAt, at.endsAt),
        courts: [],
      }
      if (!freeBands.includes(option)) freeBands.push(option)
      option.courts.push({
        id: c.id,
        name: c.name,
        price: resolveBandPriceCents(c.priceCents, c.priceRules, dateKey, b.start),
      })
    }
  }
  freeBands.sort((a, b) => a.bandStart.localeCompare(b.bandStart))
  const draft = bookingConversation({
    rand: Math.random,
    start: now,
    known,
    playerName: player.name!,
    dni,
    dateKey,
    startsAt,
    endsAt,
    bandStart: band.start,
    courtName: court.name,
    priceCents,
    transferAmountCents,
    freeBands,
    alias: club.transferAlias!,
    holder: club.transferHolder,
    welcomeExtra: club.botWelcomeExtra,
  })
  const shift = now.getTime() - 5000 - draft[draft.length - 1].createdAt.getTime()
  const messages = draft.map(m => ({ ...m, createdAt: new Date(m.createdAt.getTime() + shift) }))
  const bookedAt = messages[messages.length - 1].createdAt

  await prisma.$transaction(async tx => {
    const slot = await tx.slot.upsert({
      where: { courtId_startsAt: { courtId: court.id, startsAt } },
      update: { status: 'BOOKED', priceCents, endsAt },
      create: { clubId: club.id, courtId: court.id, startsAt, endsAt, priceCents, status: 'BOOKED' },
      select: { id: true },
    })
    await tx.booking.create({
      data: {
        clubId: club.id,
        slotId: slot.id,
        playerName: player.name!,
        playerPhone: player.phone,
        playerId: player.id,
        playerDni: dni,
        status: 'PENDING_PAYMENT',
        depositCents,
        transferAmountCents,
        paymentExpiresAt: new Date(bookedAt.getTime() + 30 * MINUTE),
        createdAt: bookedAt,
      },
    })
    await tx.player.update({ where: { id: player.id }, data: { dni } })

    const playerName = known ? player.name!.split(' ')[0] : player.name
    const session = await tx.conversationSession.findUnique({
      where: { waId_clubId: { waId: player.phone, clubId: club.id } },
      select: { id: true },
    })
    const context = sessionContextFor(messages, playerName, dni) as object
    const sessionId = session
      ? (
          await tx.conversationSession.update({
            where: { id: session.id },
            data: { state: 'MENU', context, playerName, expiresAt: new Date(now.getTime() + 30 * MINUTE) },
            select: { id: true },
          })
        ).id
      : (
          await tx.conversationSession.create({
            data: {
              clubId: club.id,
              waId: player.phone,
              state: 'MENU',
              context,
              playerName,
              expiresAt: new Date(now.getTime() + 30 * MINUTE),
              createdAt: messages[0].createdAt,
            },
            select: { id: true },
          })
        ).id
    await tx.conversationMessage.createMany({
      data: messages.map(m => ({ sessionId, role: m.role, content: m.content, createdAt: m.createdAt })),
    })
  })
  return true
}

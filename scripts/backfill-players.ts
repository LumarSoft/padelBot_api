import 'dotenv/config'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../generated/prisma/client'

/**
 * One-time backfill for the Player CRM: groups historical bookings by
 * (clubId, phone), creates the Player rows, links every booking to its player
 * and seeds noShowCount from already-marked no-shows. Idempotent — re-running
 * only fills the gaps.
 *
 * Usage (run from api/):
 *   npm run players:backfill
 */

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

async function main(): Promise<void> {
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
  const prisma = new PrismaClient({ adapter })

  const bookings = await prisma.booking.findMany({
    where: { playerPhone: { not: null }, playerId: null },
    select: { id: true, clubId: true, playerPhone: true, playerName: true, playerDni: true, payerMpUserId: true, noShowAt: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Bookings to link: ${bookings.length}`)

  const playerIds = new Map<string, string>() // clubId|phone → playerId
  let created = 0
  let linked = 0

  for (const b of bookings) {
    const phone = normalizePhone(b.playerPhone!)
    if (phone.length < 6) continue
    const key = `${b.clubId}|${phone}`

    let playerId = playerIds.get(key)
    if (!playerId) {
      const player = await prisma.player.upsert({
        where: { clubId_phone: { clubId: b.clubId, phone } },
        create: {
          clubId: b.clubId,
          phone,
          name: b.playerName || null,
          dni: b.playerDni,
          payerMpUserId: b.payerMpUserId,
        },
        update: {},
        select: { id: true },
      })
      playerId = player.id
      playerIds.set(key, playerId)
      created++
    }

    // Later bookings carry fresher identity — keep the newest non-null values.
    await prisma.player.update({
      where: { id: playerId },
      data: {
        ...(b.playerName ? { name: b.playerName } : {}),
        ...(b.playerDni ? { dni: b.playerDni } : {}),
        ...(b.payerMpUserId ? { payerMpUserId: b.payerMpUserId } : {}),
        ...(b.noShowAt ? { noShowCount: { increment: 1 } } : {}),
      },
    })
    await prisma.booking.update({ where: { id: b.id }, data: { playerId } })
    linked++
  }

  console.log(`Players touched: ${created}, bookings linked: ${linked}`)
  await prisma.$disconnect()
}

void main()

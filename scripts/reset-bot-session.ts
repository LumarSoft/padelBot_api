import 'dotenv/config'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../generated/prisma/client'

/**
 * Dev tool to reset bot test state so each manual test starts clean.
 *
 * Clearing the ConversationSession wipes everything stale the LLM could see —
 * the message history and any half-filled date/court/slot context — because all
 * of that lives on that row. The club, courts and real availability are always
 * read fresh from the DB on every turn, so they never go stale.
 *
 * Usage (run from api/):
 *   npm run bot:reset -- --phone 5491112345678
 *   npm run bot:reset -- --phone 5491112345678 --club club-demo
 *   npm run bot:reset -- --phone 5491112345678 --bookings   # also frees booked test slots
 *   npm run bot:reset -- --phone 5491112345678 --dry        # preview, no writes
 *
 * Flags:
 *   --phone <waId>   E.164 without '+', e.g. 5491112345678 (required)
 *   --club <slug|id> Limit to one club (default: all clubs)
 *   --bookings       Also delete this phone's CONFIRMED bookings and the slots
 *                    they occupy, returning those bands to empty so the same
 *                    turno can be re-booked from scratch.
 *   --dry            Print what would change without writing anything.
 */
function parseArgs(argv: string[]): {
  phone?: string
  club?: string
  bookings: boolean
  dry: boolean
} {
  const out = { phone: undefined as string | undefined, club: undefined as string | undefined, bookings: false, dry: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--phone') out.phone = argv[++i]
    else if (a === '--club') out.club = argv[++i]
    else if (a === '--bookings') out.bookings = true
    else if (a === '--dry') out.dry = true
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.phone) {
    console.error('Missing --phone <waId>. Example: npm run bot:reset -- --phone 5491112345678')
    process.exitCode = 1
    return
  }

  const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
  const prisma = new PrismaClient({ adapter })

  try {
    // Resolve optional club filter (accepts either a slug or a raw club id).
    let clubId: string | undefined
    if (args.club) {
      const club = await prisma.club.findFirst({
        where: { OR: [{ slug: args.club }, { id: args.club }] },
        select: { id: true, name: true, slug: true },
      })
      if (!club) {
        console.error(`No club found matching "${args.club}" (by slug or id).`)
        process.exitCode = 1
        return
      }
      clubId = club.id
      console.log(`Club filter: ${club.name} (${club.slug})`)
    }

    const sessionWhere = { waId: args.phone, ...(clubId ? { clubId } : {}) }
    const bookingWhere = { playerPhone: args.phone, status: 'CONFIRMED' as const, ...(clubId ? { clubId } : {}) }

    const sessions = await prisma.conversationSession.findMany({
      where: sessionWhere,
      select: { id: true, clubId: true, state: true },
    })

    const bookings = args.bookings
      ? await prisma.booking.findMany({
          where: bookingWhere,
          select: { id: true, slotId: true, slot: { select: { startsAt: true, court: { select: { name: true } } } } },
        })
      : []

    console.log(`\nPhone: ${args.phone}`)
    console.log(`Conversation sessions to clear: ${sessions.length}`)
    sessions.forEach(s => console.log(`  - session ${s.id} (club ${s.clubId}, state ${s.state})`))

    if (args.bookings) {
      console.log(`Confirmed bookings to delete (and free their slots): ${bookings.length}`)
      bookings.forEach(b =>
        console.log(`  - booking ${b.id} → ${b.slot.court.name} @ ${b.slot.startsAt.toISOString()}`),
      )
    }

    if (args.dry) {
      console.log('\n--dry: no changes written.')
      return
    }

    if (sessions.length === 0 && bookings.length === 0) {
      console.log('\nNothing to reset.')
      return
    }

    await prisma.$transaction(async tx => {
      // Bookings first (FK), then the slots they occupied so the band is empty
      // again and the open-by-default booking path re-materializes it fresh.
      if (bookings.length > 0) {
        const bookingIds = bookings.map(b => b.id)
        const slotIds = [...new Set(bookings.map(b => b.slotId))]
        await tx.booking.deleteMany({ where: { id: { in: bookingIds } } })
        await tx.slot.deleteMany({ where: { id: { in: slotIds } } })
      }
      if (sessions.length > 0) {
        await tx.conversationSession.deleteMany({ where: sessionWhere })
      }
    })

    console.log('\nReset done. Next message from this number starts a fresh session.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})

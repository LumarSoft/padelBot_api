import 'dotenv/config'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../generated/prisma/client'
import { SALES_DEMO_SLUG, seedSalesDemo } from '../src/demo/sales-demo.seed'

/**
 * Creates (first run) or rebuilds the sales demo club by hand. Once it exists, the API keeps it
 * fresh on its own (DemoService), so this is only needed to create it or change the password:
 *
 *   DEMO_PASSWORD='…' npm run demo:seed     # first run (creates the users) / new password
 *   npm run demo:seed                       # rebuild now (keeps the users' password)
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) })
  try {
    const s = await seedSalesDemo(prisma, { password: process.env.DEMO_PASSWORD })
    console.log(`Demo club ready: ${SALES_DEMO_SLUG}${s.passwordUpdated ? ' (password updated)' : ''}`)
    console.log(`  Courts ${s.courts} · products ${s.products} · players ${s.players} · turnos fijos ${s.recurring}`)
    console.log(
      `  Bookings ${s.bookings.total} (confirmed ${s.bookings.confirmed}, pending ${s.bookings.pending}, cancelled ${s.bookings.cancelled}) · today ${s.todayConfirmed}`,
    )
    console.log(`  Conversations ${s.conversations} · consumos ${s.consumos} · pagos ${s.payments}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error('Could not seed the sales demo club:', error)
  process.exit(1)
})

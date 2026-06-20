import 'dotenv/config'
import * as bcrypt from 'bcrypt'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient, Prisma } from '../generated/prisma/client'

const DEMO_EMAIL = 'admin@clubdemo.com'
const DEMO_PASSWORD = 'padel1234'

async function main(): Promise<void> {
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
  const prisma = new PrismaClient({ adapter })

  try {
    const club = await prisma.club.upsert({
      where: { slug: 'club-demo' },
      update: {},
      create: { name: 'Club Demo Pádel', slug: 'club-demo' },
    })

    const password = await bcrypt.hash(DEMO_PASSWORD, 12)

    await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      update: { password, name: 'Admin Demo', role: 'OWNER', clubId: club.id },
      create: {
        email: DEMO_EMAIL,
        password,
        name: 'Admin Demo',
        role: 'OWNER',
        clubId: club.id,
      },
    })

    // Demo courts + slots (only if the club has no courts yet).
    const existingCourts = await prisma.court.count({ where: { clubId: club.id } })
    if (existingCourts === 0) {
      const court1 = await prisma.court.create({
        data: { name: 'Cancha 1', clubId: club.id },
      })
      const court2 = await prisma.court.create({
        data: { name: 'Cancha 2', clubId: club.id },
      })

      // A handful of 90-minute slots for today, from 18:00.
      const base = new Date()
      base.setHours(18, 0, 0, 0)
      const courts = [court1, court2]
      const slots: Prisma.SlotCreateManyInput[] = []
      for (let i = 0; i < 4; i += 1) {
        const startsAt = new Date(base.getTime() + i * 90 * 60 * 1000)
        const endsAt = new Date(startsAt.getTime() + 90 * 60 * 1000)
        for (const court of courts) {
          slots.push({
            clubId: club.id,
            courtId: court.id,
            startsAt,
            endsAt,
            priceCents: 1200000,
          })
        }
      }
      await prisma.slot.createMany({ data: slots })
      console.log(`  Seeded ${courts.length} courts and ${slots.length} slots.`)
    }

    console.log('Seed complete.')
    console.log(`  Club:  ${club.name} (${club.slug})`)
    console.log(`  Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('Seed failed:', error)
  process.exit(1)
})

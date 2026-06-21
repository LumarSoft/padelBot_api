import 'dotenv/config'
import * as bcrypt from 'bcrypt'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../generated/prisma/client'

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

    const existingCourts = await prisma.court.count({ where: { clubId: club.id } })
    if (existingCourts === 0) {
      await prisma.court.createMany({
        data: [
          { name: 'Cancha 1', priceCents: 1200000, clubId: club.id },
          { name: 'Cancha 2', priceCents: 1200000, clubId: club.id },
        ],
      })
      console.log('  Seeded 2 courts.')
    }

    // Re-register the WhatsApp line if a PHONE_NUMBER_ID is configured.
    const phoneNumberId = process.env.PHONE_NUMBER_ID
    if (phoneNumberId) {
      await prisma.whatsAppLine.upsert({
        where: { phoneNumberId },
        update: { clubId: club.id, isActive: true },
        create: { phoneNumberId, displayPhone: phoneNumberId, clubId: club.id },
      })
      console.log(`  WhatsApp line registered: ${phoneNumberId}`)
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

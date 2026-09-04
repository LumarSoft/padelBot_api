import 'dotenv/config'
import * as bcrypt from 'bcrypt'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../generated/prisma/client'
import { ReceiptStorageService } from '../src/storage/receipt-storage.service'

const CLUB_SLUG = 'club-demo'
const REVIEW_TAG = '[APP_REVIEW_DEMO]'
const DAY_MS = 24 * 60 * 60 * 1000
const ARGENTINA_OFFSET = '-03:00'

interface DemoSlot {
  courtId: string
  startsAt: Date
  endsAt: Date
  priceCents: number
}

function argentinaDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function localDate(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time}:00${ARGENTINA_OFFSET}`)
}

function receiptSvg(sequence: number, amountCents: number, startsAt: Date): Buffer {
  const amount = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amountCents / 100)
  const date = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'long',
  }).format(startsAt)

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1500" viewBox="0 0 900 1500">
      <rect width="900" height="1500" fill="#f4f7fb"/>
      <rect x="70" y="80" width="760" height="1340" rx="42" fill="#ffffff" stroke="#d7dfeb" stroke-width="4"/>
      <circle cx="450" cy="230" r="72" fill="#2B62EB"/>
      <path d="M410 230h80M450 190v80" stroke="#fff" stroke-width="18" stroke-linecap="round"/>
      <text x="450" y="360" text-anchor="middle" font-family="Arial, sans-serif" font-size="46" font-weight="700" fill="#111827">Transferencia realizada</text>
      <text x="450" y="425" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#64748b">Comprobante de demostración</text>
      <line x1="130" y1="500" x2="770" y2="500" stroke="#e2e8f0" stroke-width="3"/>
      <text x="130" y="590" font-family="Arial, sans-serif" font-size="26" fill="#64748b">Importe</text>
      <text x="130" y="660" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#0f172a">${amount}</text>
      <text x="130" y="780" font-family="Arial, sans-serif" font-size="26" fill="#64748b">Destino</text>
      <text x="130" y="830" font-family="Arial, sans-serif" font-size="34" font-weight="600" fill="#0f172a">Lavalle Pádel</text>
      <text x="130" y="940" font-family="Arial, sans-serif" font-size="26" fill="#64748b">Fecha de la reserva</text>
      <text x="130" y="990" font-family="Arial, sans-serif" font-size="32" fill="#0f172a">${date}</text>
      <text x="130" y="1100" font-family="Arial, sans-serif" font-size="26" fill="#64748b">Operación</text>
      <text x="130" y="1150" font-family="Arial, sans-serif" font-size="32" fill="#0f172a">DEMO-APPLE-${sequence}</text>
      <rect x="130" y="1240" width="640" height="90" rx="18" fill="#eef4ff"/>
      <text x="450" y="1297" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#2B62EB">DEMO · SIN VALOR COMERCIAL</text>
    </svg>
  `)
}

async function findAvailableDemoSlot(
  prisma: PrismaClient,
  courts: Array<{ id: string; priceCents: number; slotDurationMinutes: number }>,
  startOffsetDays: number,
): Promise<DemoSlot> {
  const times = ['18:00', '19:30', '21:00']

  for (let offset = startOffsetDays; offset < startOffsetDays + 45; offset += 1) {
    const dateKey = argentinaDateKey(new Date(Date.now() + offset * DAY_MS))
    for (const court of courts) {
      for (const time of times) {
        const startsAt = localDate(dateKey, time)
        const existing = await prisma.slot.findUnique({
          where: { courtId_startsAt: { courtId: court.id, startsAt } },
          select: { status: true },
        })
        if (!existing || existing.status === 'AVAILABLE') {
          return {
            courtId: court.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + court.slotDurationMinutes * 60_000),
            priceCents: court.priceCents,
          }
        }
      }
    }
  }

  throw new Error('No future slot is available for the App Review demo data')
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

  const adapter = new PrismaMariaDb(process.env.DATABASE_URL)
  const prisma = new PrismaClient({ adapter })
  const receiptStorage = new ReceiptStorageService()

  try {
    const club = await prisma.club.findUnique({ where: { slug: CLUB_SLUG }, select: { id: true, name: true } })
    if (!club) throw new Error(`Club ${CLUB_SLUG} does not exist`)

    const owner = await prisma.user.findFirst({
      where: { clubId: club.id, email: 'admin@clubdemo.com', isActive: true },
      select: { id: true, password: true },
    })
    if (!owner) throw new Error('The active App Review demo user does not exist')
    if (!(await bcrypt.compare('padel1234', owner.password))) {
      throw new Error('The App Review demo user password does not match the credentials supplied to Apple')
    }

    const courts = await prisma.court.findMany({
      where: { clubId: club.id },
      orderBy: { createdAt: 'asc' },
      take: 2,
      select: { id: true, priceCents: true, slotDurationMinutes: true },
    })
    if (courts.length === 0) throw new Error('The demo club needs at least one court')

    const previous = await prisma.booking.findMany({
      where: { clubId: club.id, notes: { startsWith: REVIEW_TAG } },
      select: { id: true, slotId: true, receipts: { select: { url: true, storageKey: true } } },
    })

    for (const booking of previous) {
      for (const receipt of booking.receipts) await receiptStorage.delete(receipt)
      await prisma.$transaction(async tx => {
        await tx.booking.delete({ where: { id: booking.id } })
        const otherActiveBookings = await tx.booking.count({
          where: { slotId: booking.slotId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] }, deletedAt: null },
        })
        if (otherActiveBookings === 0) {
          await tx.slot.update({ where: { id: booking.slotId }, data: { status: 'AVAILABLE' } })
        }
      })
    }

    await prisma.club.update({
      where: { id: club.id },
      data: {
        paymentVerificationMode: 'RECEIPT',
        transferAlias: 'LAVALLE.PADEL.DEMO',
        transferHolder: 'Lavalle Pádel Demo',
      },
    })

    const pendingBookings: string[] = []
    for (let index = 1; index <= 3; index += 1) {
      const candidate = await findAvailableDemoSlot(prisma, courts, index + 1)
      const depositCents = Math.max(100_000, Math.ceil(candidate.priceCents * 0.25))

      const booking = await prisma.$transaction(async tx => {
        const slot = await tx.slot.upsert({
          where: { courtId_startsAt: { courtId: candidate.courtId, startsAt: candidate.startsAt } },
          update: {
            status: 'BOOKED',
            endsAt: candidate.endsAt,
            priceCents: candidate.priceCents,
          },
          create: {
            clubId: club.id,
            courtId: candidate.courtId,
            startsAt: candidate.startsAt,
            endsAt: candidate.endsAt,
            priceCents: candidate.priceCents,
            status: 'BOOKED',
          },
          select: { id: true },
        })

        return tx.booking.create({
          data: {
            clubId: club.id,
            slotId: slot.id,
            playerName: `Revisión Apple ${index}`,
            playerPhone: `54934100000${index}`,
            status: 'PENDING_PAYMENT',
            notes: `${REVIEW_TAG} Reserva pendiente ${index}`,
            depositCents,
            transferAmountCents: depositCents,
            paymentExpiresAt: new Date(Date.now() + 45 * DAY_MS),
            receiptUploadedAt: new Date(),
          },
          select: { id: true },
        })
      })

      const key = `receipts/${booking.id}/app-review-demo-${index}.svg`
      const receipt = receiptSvg(index, depositCents, candidate.startsAt)
      const stored = await receiptStorage.upload(key, receipt, 'image/svg+xml')
      await prisma.paymentReceipt.create({
        data: {
          clubId: club.id,
          bookingId: booking.id,
          storageKey: stored.key,
          url: stored.url,
          mimeType: 'image/svg+xml',
          sizeBytes: receipt.byteLength,
          waMediaId: `app-review-demo-${index}`,
        },
      })
      pendingBookings.push(booking.id)
    }

    const confirmedSlot = await findAvailableDemoSlot(prisma, courts, 6)
    const confirmedBooking = await prisma.$transaction(async tx => {
      const slot = await tx.slot.upsert({
        where: { courtId_startsAt: { courtId: confirmedSlot.courtId, startsAt: confirmedSlot.startsAt } },
        update: { status: 'BOOKED', endsAt: confirmedSlot.endsAt, priceCents: confirmedSlot.priceCents },
        create: { clubId: club.id, ...confirmedSlot, status: 'BOOKED' },
        select: { id: true },
      })
      return tx.booking.create({
        data: {
          clubId: club.id,
          slotId: slot.id,
          playerName: 'Reserva demo confirmada',
          playerPhone: '549341000009',
          status: 'CONFIRMED',
          notes: `${REVIEW_TAG} Reserva confirmada`,
          depositCents: Math.max(100_000, Math.ceil(confirmedSlot.priceCents * 0.25)),
          bookedByUserId: owner.id,
        },
        select: { id: true },
      })
    })

    console.log(`App Review demo data is ready for ${club.name}.`)
    console.log(`Pending bookings: ${pendingBookings.length}`)
    console.log(`Confirmed booking: ${confirmedBooking.id}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error('Could not prepare App Review demo data:', error)
  process.exit(1)
})

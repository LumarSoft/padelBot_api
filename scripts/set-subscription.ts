import 'dotenv/config'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient, SubscriptionStatus } from '../generated/prisma/client'

/**
 * Ops tool for MANUAL billing: flips a club's GTP subscription after a
 * transfer arrives (or lapses). This is the whole "billing system" until we
 * automate charging with MercadoPago preapproval (>10 clubs).
 *
 * Usage (run from api/):
 *   npm run subscription -- --club club-demo                        # show current state
 *   npm run subscription -- --club club-demo --status ACTIVE --months 1
 *   npm run subscription -- --club club-demo --status PAST_DUE
 *   npm run subscription -- --club club-demo --status TRIAL --days 14
 *   npm run subscription -- --club club-demo --status CANCELLED
 *   npm run subscription -- --club club-demo --plan pro
 *
 * Flags:
 *   --club <slug>      club slug (required)
 *   --status <status>  TRIAL | ACTIVE | PAST_DUE | CANCELLED
 *   --months <n>       with ACTIVE: paid months from now → currentPeriodEnd (default 1)
 *   --days <n>         with TRIAL: trial days from now → trialEndsAt (default 14)
 *   --plan <name>      base | pro
 */

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const slug = flag('club')
  if (!slug) {
    console.error('Missing --club <slug>')
    process.exit(1)
  }

  const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
  const prisma = new PrismaClient({ adapter })

  const club = await prisma.club.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      subscriptionStatus: true,
      plan: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
    },
  })
  if (!club) {
    console.error(`Club "${slug}" not found`)
    process.exit(1)
  }
  console.log('Current:', club)

  const status = flag('status')?.toUpperCase() as SubscriptionStatus | undefined
  const plan = flag('plan')
  if (!status && !plan) return

  if (status && !Object.values(SubscriptionStatus).includes(status)) {
    console.error(`Invalid --status. Use one of: ${Object.values(SubscriptionStatus).join(', ')}`)
    process.exit(1)
  }

  const DAY_MS = 24 * 60 * 60 * 1000
  const data: Record<string, unknown> = {}
  if (plan) data.plan = plan
  if (status) {
    data.subscriptionStatus = status
    if (status === 'ACTIVE') {
      const months = Number(flag('months') ?? 1)
      data.currentPeriodEnd = new Date(Date.now() + months * 30 * DAY_MS)
    }
    if (status === 'TRIAL') {
      const days = Number(flag('days') ?? 14)
      data.trialEndsAt = new Date(Date.now() + days * DAY_MS)
    }
  }

  const updated = await prisma.club.update({
    where: { id: club.id },
    data,
    select: { subscriptionStatus: true, plan: true, trialEndsAt: true, currentPeriodEnd: true },
  })
  console.log('Updated:', updated)
  await prisma.$disconnect()
}

void main()

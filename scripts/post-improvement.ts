import 'dotenv/config'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { ImprovementStatus, PrismaClient } from '../generated/prisma/client'

/**
 * Posts an improvement to "Mejoras" (panel + staff app) straight from the shell — the same
 * thing the ops console's Mejoras screen does, for when a change ships and we post it on the spot.
 * Targets whatever DATABASE_URL points at.
 *
 * Usage (run from api/):
 *   npm run improvement:post -- --title 'Torneos y peñas' --body 'Anotá parejas y …'
 *   npm run improvement:post -- --title '…' --body '…' --status PLANNED
 *   npm run improvement:post -- --title '…' --body '…' --draft        # not visible to clubs yet
 *   npm run improvement:post -- --title '…' --body '…' --suggestion <id> [--suggestion <id>]
 *                                         # marks those club suggestions as answered by it
 *   npm run improvement:post -- --list
 */

const STATUSES = Object.values(ImprovementStatus)

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function flags(name: string): string[] {
  return process.argv.flatMap((arg, i) => (arg === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]] : []))
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main(): Promise<void> {
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
  const prisma = new PrismaClient({ adapter })

  if (has('list')) {
    const rows = await prisma.improvement.findMany({
      select: { id: true, title: true, status: true, publishedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    console.table(rows)
    await prisma.$disconnect()
    return
  }

  const title = flag('title')?.trim()
  const body = flag('body')?.trim()
  if (!title || !body) {
    console.error("Missing --title '…' and/or --body '…'  (or --list)")
    process.exit(1)
  }
  if (title.length > 120) {
    console.error(`--title is ${title.length} characters; the limit is 120.`)
    process.exit(1)
  }

  const status = (flag('status') ?? 'RELEASED').toUpperCase() as ImprovementStatus
  if (!STATUSES.includes(status)) {
    console.error(`--status must be one of ${STATUSES.join(', ')}`)
    process.exit(1)
  }

  const improvement = await prisma.improvement.create({
    data: { title, body, status, publishedAt: has('draft') ? null : new Date() },
    select: { id: true, publishedAt: true },
  })
  console.log(`${improvement.publishedAt ? 'Published' : 'Saved as draft'}: ${title} (${improvement.id})`)

  const suggestionIds = flags('suggestion')
  if (suggestionIds.length > 0) {
    const { count } = await prisma.improvementSuggestion.updateMany({
      where: { id: { in: suggestionIds } },
      data: { improvementId: improvement.id, status: status === 'RELEASED' ? 'DONE' : 'PLANNED' },
    })
    console.log(`Linked ${count} of ${suggestionIds.length} suggestion(s)`)
  }

  await prisma.$disconnect()
}

void main()

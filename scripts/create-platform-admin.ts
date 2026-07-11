import 'dotenv/config'
import * as bcrypt from 'bcrypt'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../generated/prisma/client'

/**
 * Bootstraps a Lumarsoft operator (the ops console at `/ops`). There is no self-signup and
 * no UI for this on purpose: a platform admin sees every tenant, so the only way to mint one
 * is shell access to the server.
 *
 * Usage (run from padelBot_api/):
 *   npm run ops:admin -- --email mateo@lumarsoft.com --name Mateo --password '…'
 *   npm run ops:admin -- --email mateo@lumarsoft.com --password '…'   # rotate the password
 *   npm run ops:admin -- --email mateo@lumarsoft.com --deactivate
 *   npm run ops:admin -- --list
 */

const BCRYPT_ROUNDS = 10

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main(): Promise<void> {
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
  const prisma = new PrismaClient({ adapter })

  if (has('list')) {
    const admins = await prisma.platformAdmin.findMany({
      select: { id: true, email: true, name: true, isActive: true, lastLoginAt: true },
      orderBy: { id: 'asc' },
    })
    console.table(admins)
    await prisma.$disconnect()
    return
  }

  const email = flag('email')?.toLowerCase().trim()
  if (!email) {
    console.error('Missing --email <email>  (or --list)')
    process.exit(1)
  }

  if (has('deactivate')) {
    await prisma.platformAdmin.update({ where: { email }, data: { isActive: false } })
    console.log(`Deactivated ${email}`)
    await prisma.$disconnect()
    return
  }

  const password = flag('password')
  if (!password) {
    console.error('Missing --password <password>')
    process.exit(1)
  }
  // Says the length it GOT, because the usual cause is a shell that ate the argument or a
  // placeholder pasted verbatim — and "missing or too short" sends you looking for the wrong bug.
  if (password.length < 10) {
    console.error(
      `--password is ${password.length} characters; it needs at least 10. ` +
        'This account reads every club, so it does not get a throwaway password.',
    )
    process.exit(1)
  }

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS)
  const existing = await prisma.platformAdmin.findUnique({ where: { email } })

  if (existing) {
    await prisma.platformAdmin.update({
      where: { email },
      data: { password: hashed, isActive: true },
    })
    console.log(`Password rotated for ${email}`)
  } else {
    const name = flag('name')
    if (!name) {
      console.error('Missing --name <name> for a new admin')
      process.exit(1)
    }
    await prisma.platformAdmin.create({ data: { email, name, password: hashed } })
    console.log(`Created platform admin ${email}`)
  }

  if (!process.env.OPS_JWT_SECRET) {
    console.warn(
      '\n⚠️  OPS_JWT_SECRET is not set — the ops console will refuse every request until it is.\n' +
        '   Generate one with:  openssl rand -hex 32',
    )
  }

  await prisma.$disconnect()
}

void main()

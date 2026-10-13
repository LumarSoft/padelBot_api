import * as bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
// Relative on purpose: `npm run demo:seed` runs this through ts-node, which doesn't resolve the
// `generated/…` baseUrl alias that Nest's build rewrites.
import { PrismaClient } from '../../generated/prisma/client'
import { bandDateTimes, bandsForDate, ScheduleBand, WeeklyHours } from '../availability/lib/schedule'
import { PriceRule, resolveBandPriceCents } from '../availability/lib/pricing'
import {
  dayLabelFromKey,
  formatDayMonth,
  formatTimeRange,
  shiftDateKey,
  toDateKey,
  todayKey,
  weekdayOfKey,
} from '../availability/lib/datetime'
import { splitEqually } from '../bookings/lib/account'
import {
  askRescheduleDate,
  confirmBooking,
  dayAvailabilityList,
  myBookingsList,
  paymentClaimAck,
  rescheduleConfirm,
  rescheduleDone,
  thanksReply,
  transferPending,
  welcome,
  MENU,
} from '../bot/messages'
import { BandOption, SessionContext } from '../bot/types'
import { bookingConversation } from './lib/booking-conversation'

/**
 * Sales demo club ("Distrito Pádel") — a fully populated tenant to show GTP end to end to
 * prospects: two months of history, a busy agenda for the coming weeks, turnos fijos, players
 * CRM, kiosco sales and bill closures, reports, and WhatsApp conversations written with the
 * bot's real copy.
 *
 * Everything is relative to the moment it runs. `DemoService` rebuilds it every night and keeps
 * it alive during the day (see `sales-demo.live.ts`); `npm run demo:seed` does it by hand.
 *
 * A rebuild wipes the club's CONTENT (courts, bookings, players, products, conversations…). It
 * never touches other clubs, and it keeps what is connected by hand: the users and their
 * passwords, the WhatsApp line, the MercadoPago connection, the transfer alias/holder and the
 * payment-verification settings.
 *
 * Every player phone is in the 341-0xx-xxxx range, which doesn't exist in Argentina (local
 * numbers never start with 0): if the club's real WhatsApp line ever tries to message a demo
 * player (reminder, expiry, waitlist), Meta rejects it instead of reaching a real person.
 */

export const SALES_DEMO_SLUG = 'distrito-padel'
const CLUB_SLUG = SALES_DEMO_SLUG
/** Digits every demo player phone starts with (see the header). */
export const DEMO_PHONE_PREFIX = '5493410'
const CLUB_NAME = 'Distrito Pádel'
const OWNER = { email: 'demo@gestionatupadel.com', name: 'Lucía Ferraro' }
const STAFF = [
  { email: 'recepcion.distrito@gestionatupadel.com', name: 'Santiago Ríos' },
  { email: 'noche.distrito@gestionatupadel.com', name: 'Carolina Benítez' },
]
const DEMO_ALIAS = 'DISTRITO.PADEL.DEMO'
const DEMO_HOLDER = 'Distrito Pádel SRL'

const HISTORY_DAYS = 56
const FUTURE_DAYS = 21
const RECURRING_WEEKS_AHEAD = 8
const DEPOSIT_PERCENT = 25

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// ── Deterministic randomness (same "shape" of club on every refresh) ──────────

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 20261012
let rand = mulberry32(SEED)
const chance = (p: number): boolean => rand() < p
const randInt = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1))
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]

let idSequence = 0
function newId(): string {
  idSequence += 1
  return `c${Date.now().toString(36)}${idSequence.toString(36).padStart(5, '0')}${randomBytes(4).toString('hex')}`
}

const addMs = (date: Date, ms: number): Date => new Date(date.getTime() + ms)
const minDate = (a: Date, b: Date): Date => (a < b ? a : b)

// ── Catalog ─────────────────────────────────────────────────────────────────

interface CourtDef {
  key: string
  name: string
  courtType: 'INDOOR' | 'OUTDOOR'
  closeTime: string
  weeklyHours: WeeklyHours
  baseCents: number
  primeCents: number
  morningCents: number
  demand: number
}

const MORNING_STARTS = ['08:00', '09:30', '11:00']
const PRIME_STARTS = ['18:30', '20:00', '21:30']

const COURT_DEFS: CourtDef[] = [
  {
    key: 'c1',
    name: 'Cancha 1 · Panorámica',
    courtType: 'INDOOR',
    closeTime: '00:30',
    weeklyHours: { '0': { open: '09:30', close: '23:00' } },
    baseCents: 3_600_000,
    primeCents: 4_200_000,
    morningCents: 3_000_000,
    demand: 1,
  },
  {
    key: 'c2',
    name: 'Cancha 2 · Panorámica',
    courtType: 'INDOOR',
    closeTime: '00:30',
    weeklyHours: { '0': { open: '09:30', close: '23:00' } },
    baseCents: 3_600_000,
    primeCents: 4_200_000,
    morningCents: 3_000_000,
    demand: 0.97,
  },
  {
    key: 'c3',
    name: 'Cancha 3 · Blindex',
    courtType: 'INDOOR',
    closeTime: '00:30',
    weeklyHours: { '0': { open: '09:30', close: '23:00' } },
    baseCents: 3_400_000,
    primeCents: 4_000_000,
    morningCents: 2_800_000,
    demand: 0.9,
  },
  {
    key: 'c4',
    name: 'Cancha 4 · Descubierta',
    courtType: 'OUTDOOR',
    closeTime: '23:00',
    weeklyHours: { '0': { open: '09:30', close: '21:30' } },
    baseCents: 3_000_000,
    primeCents: 3_400_000,
    morningCents: 2_600_000,
    demand: 0.72,
  },
]

const PRODUCT_DEFS = [
  { key: 'head', name: 'Tubo Head Padel Pro x3', priceCents: 1_400_000, category: 'PELOTA', isActive: true },
  { key: 'bull', name: 'Tubo Bullpadel Premium x3', priceCents: 1_250_000, category: 'PELOTA', isActive: true },
  { key: 'agua', name: 'Agua mineral 500 ml', priceCents: 200_000, category: 'BEBIDA', isActive: true },
  { key: 'saborizada', name: 'Agua saborizada 500 ml', priceCents: 250_000, category: 'BEBIDA', isActive: true },
  { key: 'gatorade', name: 'Gatorade 500 ml', priceCents: 350_000, category: 'BEBIDA', isActive: true },
  { key: 'coca', name: 'Coca-Cola 500 ml', priceCents: 300_000, category: 'BEBIDA', isActive: true },
  { key: 'cerveza', name: 'Cerveza lata 473 ml', priceCents: 400_000, category: 'BEBIDA', isActive: true },
  { key: 'powerade', name: 'Powerade 500 ml', priceCents: 320_000, category: 'BEBIDA', isActive: false },
  { key: 'barrita', name: 'Barrita de cereal', priceCents: 150_000, category: 'SNACK', isActive: true },
  { key: 'alfajor', name: 'Alfajor triple', priceCents: 180_000, category: 'SNACK', isActive: true },
  { key: 'grip', name: 'Overgrip', priceCents: 450_000, category: 'ACCESORIO', isActive: true },
  { key: 'munequera', name: 'Muñequera', priceCents: 300_000, category: 'ACCESORIO', isActive: true },
  { key: 'paleta', name: 'Alquiler de paleta', priceCents: 600_000, category: 'OTRO', isActive: true },
] as const

const LOCATION_INFO =
  'Bv. 27 de Febrero 2050, Rosario (entre Castellanos y Ovidio Lagos). ' +
  'Estacionamiento propio y gratuito para clientes, con entrada por la calle lateral. ' +
  'Llegan las líneas 102, 112 y 133.'

const WELCOME_EXTRA =
  '🏟️ Canchas 1, 2 y 3 techadas: se juega llueva o truene. 🍻 Buffet abierto todos los días de 17 a 00 h.'

const BOT_FAQ = [
  {
    question: '¿Cuál es el horario del club?',
    answer: 'Abrimos de lunes a sábados de 8 a 00:30 h y los domingos de 9:30 a 23 h. Los turnos son de 90 minutos.',
  },
  {
    question: '¿Tienen estacionamiento?',
    answer:
      'Sí, estacionamiento propio y gratuito para clientes (lugar para 20 autos) y bicicletero. La entrada es por la calle lateral.',
  },
  {
    question: '¿Alquilan paletas?',
    answer: 'Sí, alquilamos paletas a $6.000 por turno. Pedila en recepción al llegar (sujeto a disponibilidad).',
  },
  {
    question: '¿Venden pelotas?',
    answer:
      'Sí, en el kiosco tenemos tubos Head Padel Pro ($14.000) y Bullpadel Premium ($12.500). También agua, bebidas isotónicas y snacks.',
  },
  {
    question: '¿Tienen vestuarios y duchas?',
    answer: 'Sí, vestuarios de damas y caballeros con duchas con agua caliente y lockers.',
  },
  {
    question: '¿Qué pasa si llueve?',
    answer:
      'Las canchas 1, 2 y 3 son techadas, así que se juega igual. Si tenías la Cancha 4 (descubierta) te pasamos a una techada si hay lugar, o te reprogramamos el turno sin costo.',
  },
  {
    question: '¿Cómo es la política de cancelación?',
    answer:
      'Si cancelás con más de 24 h de anticipación, la seña te queda como crédito para tu próximo turno. Con menos de 24 h la seña se pierde. Si solo necesitás cambiar el horario, te lo muevo yo por acá (hasta 6 h antes) y la seña sigue valiendo.',
  },
  {
    question: '¿Qué medios de pago aceptan?',
    answer:
      'La seña se paga por transferencia (Mercado Pago o cualquier banco). El resto del turno se abona en el club en efectivo, QR o transferencia, y cada jugador puede pagar su parte por separado.',
  },
  {
    question: '¿Dan clases?',
    answer:
      'Sí: clases particulares y grupales para todos los niveles, clases para damas los miércoles a las 11 h y escuelita para chicos de 6 a 14 años los sábados a las 9:30 h. Los precios los pasan en recepción.',
  },
  {
    question: '¿Hacen torneos?',
    answer:
      'Sí, un torneo americano por mes y liga por categorías. Te avisamos por acá cuando abren las inscripciones.',
  },
  {
    question: '¿Tienen buffet?',
    answer:
      'Sí, buffet con cafetería, tostados, picadas y cerveza tirada, abierto todos los días de 17 a 00 h. Ideal para el tercer tiempo.',
  },
  {
    question: '¿Hacen eventos o cumpleaños?',
    answer:
      'Sí, armamos eventos de empresa y cumpleaños con canchas + buffet. Escribinos y te pasamos con el equipo para armar el presupuesto.',
  },
]

const FIRST_NAMES_M = [
  'Martín',
  'Juan',
  'Nicolás',
  'Facundo',
  'Matías',
  'Lucas',
  'Santiago',
  'Tomás',
  'Franco',
  'Gonzalo',
  'Agustín',
  'Joaquín',
  'Ignacio',
  'Federico',
  'Lautaro',
  'Bruno',
  'Ezequiel',
  'Damián',
  'Leandro',
  'Mariano',
  'Pablo',
  'Sebastián',
  'Diego',
  'Rodrigo',
  'Hernán',
  'Maximiliano',
  'Emiliano',
  'Julián',
  'Cristian',
  'Andrés',
]
const FIRST_NAMES_F = [
  'Lucía',
  'Sofía',
  'Valentina',
  'Camila',
  'Florencia',
  'Agustina',
  'Micaela',
  'Julieta',
  'Martina',
  'Carolina',
  'Paula',
  'Victoria',
  'Rocío',
  'Belén',
  'Natalia',
  'Antonella',
  'Milagros',
  'Daniela',
  'Luciana',
  'Celeste',
]
const LAST_NAMES = [
  'González',
  'Rodríguez',
  'Gómez',
  'Fernández',
  'López',
  'Díaz',
  'Martínez',
  'Pérez',
  'García',
  'Sánchez',
  'Romero',
  'Sosa',
  'Álvarez',
  'Torres',
  'Ruiz',
  'Ramírez',
  'Flores',
  'Acosta',
  'Benítez',
  'Medina',
  'Herrera',
  'Suárez',
  'Aguirre',
  'Pereyra',
  'Gutiérrez',
  'Giménez',
  'Molina',
  'Silva',
  'Castro',
  'Rojas',
  'Ortiz',
  'Núñez',
  'Luna',
  'Juárez',
  'Cabrera',
  'Ríos',
  'Ferreyra',
  'Godoy',
  'Morales',
  'Domínguez',
  'Quiroga',
  'Vera',
  'Maidana',
  'Coria',
  'Bustos',
  'Cáceres',
  'Ledesma',
  'Peralta',
  'Paz',
  'Bianchi',
]

const BOOKING_NOTES = [
  'Traen pelotas propias',
  'Primera vez en el club',
  'Si se libera, prefieren la Cancha 1',
  'Alquilan 2 paletas',
  'Clase particular con el profe Nico',
  'Festejan un cumpleaños, se quedan al buffet',
  'Vienen a probar la panorámica',
]

// ── In-memory model ───────────────────────────────────────────────────────────

interface SeedCourt extends CourtDef {
  id: string
  openTime: string
  slotDurationMinutes: number
  rules: PriceRule[]
}

interface SeedPlayer {
  id: string
  name: string
  phone: string
  dni: string
  gender: 'M' | 'F'
  mpUserId: string
  weight: number
  bookings: SeedBooking[]
  noShowCount: number
  creditCents: number
  isBlocked: boolean
  notes: string | null
  inPool: boolean
}

interface SeedSlot {
  id: string
  courtId: string
  startsAt: Date
  endsAt: Date
  priceCents: number
  status: 'AVAILABLE' | 'BOOKED' | 'BLOCKED'
  createdAt: Date
}

interface SeedLine {
  productKey: string
  quantity: number
  unitPriceCents: number
  playerMask: number
  createdAt: Date
}

interface SeedPayment {
  playerSlot: number
  amountCents: number
  method: 'CASH' | 'QR' | 'TRANSFER'
  createdAt: Date
}

type Source = 'BOT' | 'PANEL' | 'RECURRING'

interface SeedBooking {
  id: string
  slot: SeedSlot
  court: SeedCourt
  dateKey: string
  band: ScheduleBand
  source: Source
  player: SeedPlayer | null
  playerName: string
  playerPhone: string | null
  playerDni: string | null
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED'
  depositCents: number
  transferAmountCents: number | null
  creditAppliedCents: number
  mpPaymentId: string | null
  payerCuit: string | null
  payerMpUserId: string | null
  paymentExpiresAt: Date | null
  depositOutcome: 'CREDITED' | 'FORFEITED' | 'REFUNDED' | null
  bookedByUserId: number | null
  recurringBookingId: string | null
  notes: string | null
  noShowAt: Date | null
  localPaymentCents: number
  localPaymentMethod: string | null
  settledAt: Date | null
  reminderSentAt: Date | null
  rescheduleCount: number
  createdAt: Date
  updatedAt: Date
  lines: SeedLine[]
  payments: SeedPayment[]
}

interface SeedRecurring {
  id: string
  court: SeedCourt
  dayOfWeek: number
  slotStart: string
  slotEnd: string
  playerName: string
  playerPhone: string
  priceCents: number
  notes: string | null
  untilDate: Date | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

interface SeedMessage {
  role: 'USER' | 'BOT' | 'ADMIN'
  content: string
  createdAt: Date
}

interface SeedSession {
  id: string
  waId: string
  playerName: string | null
  state: string
  mode: 'AI' | 'HUMAN'
  needsAdvisor: boolean
  context: SessionContext
  messages: SeedMessage[]
  createdAt: Date
}

// ── Seed ──────────────────────────────────────────────────────────────────────

export interface SalesDemoOptions {
  /** Sets the users' password (required the first time, when the users are created). */
  password?: string
  /**
   * When the demo conversations "happened". Defaults to now; the nightly rebuild passes the
   * previous evening so the chats aren't stamped at 5 a.m.
   */
  storyAnchor?: Date
}

export interface SalesDemoSummary {
  clubId: string
  passwordUpdated: boolean
  courts: number
  products: number
  players: number
  recurring: number
  bookings: { total: number; confirmed: number; pending: number; cancelled: number }
  todayConfirmed: number
  conversations: number
  consumos: number
  payments: number
}

/** Rebuilds the sales demo club's content (creating the club and users the first time). */
export async function seedSalesDemo(prisma: PrismaClient, options: SalesDemoOptions = {}): Promise<SalesDemoSummary> {
  rand = mulberry32(SEED)
  idSequence = 0
  const now = new Date()
  const anchor = options.storyAnchor && options.storyAnchor < now ? options.storyAnchor : now
  const today = todayKey()

  {
    // ── 1. Club (settings connected by hand survive a refresh) ────────────────
    const existingClub = await prisma.club.findUnique({
      where: { slug: CLUB_SLUG },
      select: { id: true, createdAt: true, transferAlias: true, transferHolder: true },
    })
    const clubCreatedAt = existingClub?.createdAt ?? addMs(now, -(HISTORY_DAYS + 20) * DAY)
    const clubContent = {
      name: CLUB_NAME,
      subscriptionStatus: 'ACTIVE' as const,
      plan: 'pro',
      trialEndsAt: null,
      currentPeriodEnd: addMs(now, 365 * DAY),
      setupCompletedAt: addMs(clubCreatedAt, 2 * DAY),
      setupProgress: {
        currentStep: null,
        doneSteps: ['complejo', 'canchas', 'pagos', 'whatsapp', 'fijos', 'equipo', 'kiosco'],
      },
      depositMode: 'DEPOSIT' as const,
      depositPercent: DEPOSIT_PERCENT,
      botWelcomeExtra: WELCOME_EXTRA,
      locationInfo: LOCATION_INFO,
      botFaq: BOT_FAQ,
      cancellationWindowHours: 24,
      playerReschedule: 'SELF' as const,
      playerRescheduleCutoffHours: 6,
      maxPlayerReschedules: 1,
    }
    const club = existingClub
      ? await prisma.club.update({
          where: { id: existingClub.id },
          data: {
            ...clubContent,
            transferAlias: existingClub.transferAlias ?? DEMO_ALIAS,
            transferHolder: existingClub.transferHolder ?? DEMO_HOLDER,
          },
          select: { id: true, transferAlias: true, transferHolder: true },
        })
      : await prisma.club.create({
          data: {
            ...clubContent,
            slug: CLUB_SLUG,
            transferAlias: DEMO_ALIAS,
            transferHolder: DEMO_HOLDER,
            // AUTO is the headline feature (the transfer confirms itself). Saving the Pagos tab
            // in AUTO forces the DNI check on, so the demo starts in the state the panel saves.
            paymentVerificationMode: 'AUTO',
            requireDniMatch: true,
            createdAt: clubCreatedAt,
          },
          select: { id: true, transferAlias: true, transferHolder: true },
        })
    const clubId = club.id
    const alias = club.transferAlias ?? DEMO_ALIAS
    const holder = club.transferHolder ?? DEMO_HOLDER

    // ── 2. Users (password only set on creation or when DEMO_PASSWORD is given) ─
    const password = options.password
    const passwordHash = password ? await bcrypt.hash(password, 10) : null
    const userIds: Record<string, number> = {}
    for (const [index, def] of [OWNER, ...STAFF].entries()) {
      const role = index === 0 ? 'OWNER' : 'STAFF'
      const existing = await prisma.user.findUnique({ where: { email: def.email }, select: { id: true, clubId: true } })
      if (existing && existing.clubId !== clubId) {
        throw new Error(`${def.email} belongs to another club; refusing to move it`)
      }
      if (!existing && !passwordHash) {
        throw new Error(`DEMO_PASSWORD is required to create ${def.email}`)
      }
      const data = {
        name: def.name,
        role: role as 'OWNER' | 'STAFF',
        isActive: true,
        mustChangePassword: false,
        lastLoginAt: index === 0 ? now : addMs(now, -randInt(2, 30) * HOUR),
        ...(passwordHash ? { password: passwordHash } : {}),
      }
      const user = existing
        ? await prisma.user.update({ where: { id: existing.id }, data, select: { id: true } })
        : await prisma.user.create({
            data: { ...data, email: def.email, password: passwordHash!, clubId, createdAt: addMs(clubCreatedAt, DAY) },
            select: { id: true },
          })
      userIds[def.email] = user.id
    }
    const ownerId = userIds[OWNER.email]
    const staffIds = STAFF.map(s => userIds[s.email])

    // ── 3. Wipe the previous demo content (this club only) ──────────────────
    await prisma.booking.deleteMany({ where: { clubId } })
    await prisma.slot.deleteMany({ where: { clubId } })
    await prisma.recurringBooking.deleteMany({ where: { clubId } })
    await prisma.court.deleteMany({ where: { clubId } })
    await prisma.player.deleteMany({ where: { clubId } })
    await prisma.product.deleteMany({ where: { clubId } })
    await prisma.conversationSession.deleteMany({ where: { clubId } })
    await prisma.waitlistEntry.deleteMany({ where: { clubId } })
    await prisma.scheduledPriceAdjustment.deleteMany({ where: { clubId } })
    await prisma.llmUsageDaily.deleteMany({ where: { clubId } })

    // ── 4. Build the club in memory ─────────────────────────────────────────
    const courts: SeedCourt[] = COURT_DEFS.map(def => ({
      ...def,
      id: newId(),
      openTime: '08:00',
      slotDurationMinutes: 90,
      rules: [
        ...MORNING_STARTS.map(startTime => ({ dayOfWeek: null, startTime, priceCents: def.morningCents })),
        ...PRIME_STARTS.map(startTime => ({ dayOfWeek: null, startTime, priceCents: def.primeCents })),
      ],
    }))
    const courtByKey = Object.fromEntries(courts.map(c => [c.key, c])) as Record<string, SeedCourt>

    const products = PRODUCT_DEFS.map(def => ({ ...def, id: newId() }))
    const productByKey = Object.fromEntries(products.map(p => [p.key, p]))

    // Players: 12 regulars with a habit, 30 frequent, the rest occasional.
    const players: SeedPlayer[] = []
    const usedNames = new Set<string>()
    for (let i = 0; i < 110; i += 1) {
      const gender = i % 4 === 3 ? 'F' : 'M'
      let name = ''
      do {
        name = `${pick(gender === 'F' ? FIRST_NAMES_F : FIRST_NAMES_M)} ${pick(LAST_NAMES)}`
      } while (usedNames.has(name) || name === OWNER.name || STAFF.some(s => s.name === name))
      usedNames.add(name)
      players.push({
        id: newId(),
        name,
        phone: `5493410${String(100000 + i * 7919).slice(-6)}`,
        dni: String(randInt(25_000_000, 45_999_999)),
        gender,
        mpUserId: String(randInt(150_000_000, 1_900_000_000)),
        weight: i < 12 ? 5 : i < 42 ? 2.5 : 1,
        bookings: [],
        noShowCount: 0,
        creditCents: 0,
        isBlocked: false,
        notes: null,
        inPool: true,
      })
    }
    // The protagonists of the demo conversations get fixed, distinct names (the chat list shows
    // first names, so three random "Agustín" in a row would look fake).
    const STORY_NAMES: Record<number, { name: string; gender: 'M' | 'F' }> = {
      0: { name: 'Martín Acosta', gender: 'M' },
      50: { name: 'Tomás Sánchez', gender: 'M' },
      51: { name: 'Valentina Ferreyra', gender: 'F' },
      52: { name: 'Diego Giménez', gender: 'M' },
      53: { name: 'Joaquín Rojas', gender: 'M' },
      54: { name: 'Florencia Medina', gender: 'F' },
      55: { name: 'Nicolás Bianchi', gender: 'M' },
      56: { name: 'Camila Herrera', gender: 'F' },
      57: { name: 'Gonzalo Paz', gender: 'M' },
      59: { name: 'Carolina Luna', gender: 'F' },
      61: { name: 'Bruno Quiroga', gender: 'M' },
    }
    const storyFirstNames = new Set(Object.values(STORY_NAMES).map(n => n.name.split(' ')[0]))
    players.forEach((p, i) => {
      const fixed = STORY_NAMES[i]
      if (fixed) {
        p.name = fixed.name
        p.gender = fixed.gender
      } else if (storyFirstNames.has(p.name.split(' ')[0])) {
        // Keep story first names unique so each chat reads as its own person.
        const pool = (p.gender === 'F' ? FIRST_NAMES_F : FIRST_NAMES_M).filter(n => !storyFirstNames.has(n))
        let name = p.name
        do name = `${pick(pool)} ${pick(LAST_NAMES)}`
        while (players.some(o => o.name === name))
        p.name = name
      }
    })
    const regulars = players.slice(0, 12)
    const firstName = (p: SeedPlayer): string => p.name.split(' ')[0]

    const slots = new Map<string, SeedSlot>()
    const bookings: SeedBooking[] = []
    const recurring: SeedRecurring[] = []
    let mpSequence = 0

    const slotKey = (courtId: string, startsAt: Date): string => `${courtId}|${startsAt.toISOString()}`
    const isTaken = (court: SeedCourt, startsAt: Date): boolean => {
      const slot = slots.get(slotKey(court.id, startsAt))
      return !!slot && slot.status !== 'AVAILABLE'
    }
    const bandPrice = (court: SeedCourt, dateKey: string, band: ScheduleBand): number =>
      resolveBandPriceCents(court.baseCents, court.rules, dateKey, band.start)
    const findBand = (court: SeedCourt, dateKey: string, start: string): ScheduleBand | undefined =>
      bandsForDate(court, dateKey).find(b => b.start === start)
    const deposit = (priceCents: number): number => Math.ceil((priceCents * DEPOSIT_PERCENT) / 100)
    const roundPesos = (cents: number): number => Math.round(cents / 100) * 100
    const cuit = (p: SeedPlayer): string => `${p.gender === 'F' ? '27' : '20'}-${p.dni}-${randInt(0, 9)}`
    const nextMpId = (): string => String(99_120_000_000 + (mpSequence += 1) * 37)

    function ensureSlot(
      court: SeedCourt,
      dateKey: string,
      band: ScheduleBand,
      priceCents: number,
      createdAt: Date,
    ): SeedSlot {
      const { startsAt, endsAt } = bandDateTimes(dateKey, band)
      const key = slotKey(court.id, startsAt)
      let slot = slots.get(key)
      if (!slot) {
        slot = { id: newId(), courtId: court.id, startsAt, endsAt, priceCents, status: 'AVAILABLE', createdAt }
        slots.set(key, slot)
      }
      if (createdAt < slot.createdAt) slot.createdAt = createdAt
      return slot
    }

    /** When the booking was made: same-day, a couple of days or a week ahead, never in the future. */
    function bookingCreatedAt(startsAt: Date, minAge = 3 * MINUTE): Date {
      const latest = addMs(now, -minAge)
      // Same lead-time mix as the history, but only leads that already happened (no future
      // createdAt): resampling instead of clamping keeps the 14-day chart free of a fake spike.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const r = rand()
        const leadHours = r < 0.3 ? 1 + rand() * 8 : r < 0.72 ? 20 + rand() * 50 : 72 + rand() * 170
        const createdAt = addMs(startsAt, -leadHours * HOUR)
        if (createdAt <= latest) return createdAt
      }
      // Booked further ahead than usual: sometime in the last few days.
      const createdAt = addMs(latest, -Math.pow(rand(), 1.5) * 4 * DAY)
      return createdAt < startsAt ? createdAt : addMs(startsAt, -2 * HOUR)
    }

    interface BookSpec {
      source: Source
      player?: SeedPlayer | null
      playerName?: string
      playerPhone?: string | null
      status?: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED'
      createdAt?: Date
      priceCents?: number
      recurringBookingId?: string | null
      bookedByUserId?: number | null
      notes?: string | null
    }

    /** Creates a booking the way the app would for its source (bot / panel / turno fijo). */
    function book(court: SeedCourt, dateKey: string, band: ScheduleBand, spec: BookSpec): SeedBooking {
      const priceCents = spec.priceCents ?? bandPrice(court, dateKey, band)
      const { startsAt } = bandDateTimes(dateKey, band)
      const createdAt = spec.createdAt ?? bookingCreatedAt(startsAt, spec.source === 'BOT' ? 30 * MINUTE : 10 * MINUTE)
      const slot = ensureSlot(court, dateKey, band, priceCents, createdAt)
      const player = spec.player ?? null
      const status = spec.status ?? 'CONFIRMED'
      const booking: SeedBooking = {
        id: newId(),
        slot,
        court,
        dateKey,
        band,
        source: spec.source,
        player,
        playerName: spec.playerName ?? player?.name ?? 'Sin nombre',
        playerPhone: spec.playerPhone !== undefined ? spec.playerPhone : (player?.phone ?? null),
        playerDni: null,
        status,
        depositCents: 0,
        transferAmountCents: null,
        creditAppliedCents: 0,
        mpPaymentId: null,
        payerCuit: null,
        payerMpUserId: null,
        paymentExpiresAt: null,
        depositOutcome: null,
        bookedByUserId: null,
        recurringBookingId: spec.recurringBookingId ?? null,
        notes: spec.notes ?? null,
        noShowAt: null,
        localPaymentCents: 0,
        localPaymentMethod: null,
        settledAt: null,
        reminderSentAt: null,
        rescheduleCount: 0,
        createdAt,
        updatedAt: createdAt,
        lines: [],
        payments: [],
      }

      if (spec.source === 'BOT') {
        booking.depositCents = deposit(priceCents)
        booking.transferAmountCents = roundPesos(booking.depositCents)
        booking.paymentExpiresAt = addMs(createdAt, 30 * MINUTE)
        booking.playerDni = player?.dni ?? null
        if (status === 'CONFIRMED') markTransferDetected(booking, addMs(createdAt, (1.5 + rand() * 14) * MINUTE))
      } else if (spec.source === 'PANEL') {
        booking.depositCents = deposit(priceCents)
        booking.bookedByUserId = spec.bookedByUserId ?? (chance(0.3) ? ownerId : pick(staffIds))
        if (status === 'CONFIRMED') {
          booking.updatedAt = minDate(addMs(createdAt, (10 + rand() * 300) * MINUTE), minDate(startsAt, now))
        }
      }

      if (status !== 'CANCELLED') slot.status = 'BOOKED'
      bookings.push(booking)
      player?.bookings.push(booking)
      return booking
    }

    function markTransferDetected(booking: SeedBooking, at: Date): void {
      booking.status = 'CONFIRMED'
      booking.mpPaymentId = nextMpId()
      booking.payerCuit = booking.player ? cuit(booking.player) : null
      booking.payerMpUserId = booking.player?.mpUserId ?? null
      booking.updatedAt = minDate(at, addMs(now, -MINUTE))
    }

    function pickPlayer(): SeedPlayer {
      const pool = players.filter(p => p.inPool)
      const total = pool.reduce((sum, p) => sum + p.weight, 0)
      let r = rand() * total
      for (const p of pool) {
        r -= p.weight
        if (r <= 0) return p
      }
      return pool[pool.length - 1]
    }

    /** A regular booking that may end up cancelled (and maybe resold), as real life goes. */
    const playsAt = (p: SeedPlayer, startsAt: Date): boolean =>
      p.bookings.some(b => b.status !== 'CANCELLED' && b.slot.startsAt.getTime() === startsAt.getTime())

    function bookOrganic(
      court: SeedCourt,
      dateKey: string,
      band: ScheduleBand,
      player: SeedPlayer,
      source: 'BOT' | 'PANEL',
    ): void {
      const { startsAt } = bandDateTimes(dateKey, band)
      if (playsAt(player, startsAt)) return
      const isPast = startsAt <= now
      const cancelRate = isPast ? 0.05 : 0.03
      if (!chance(cancelRate)) {
        const walkIn = source === 'PANEL' && chance(0.12)
        book(court, dateKey, band, {
          source,
          player: walkIn ? null : player,
          playerName: walkIn ? `${firstName(player)} ${player.name.split(' ')[1][0]}.` : undefined,
          playerPhone: walkIn ? null : undefined,
          notes: chance(0.06) ? pick(BOOKING_NOTES) : null,
        })
        return
      }

      const cancelled = book(court, dateKey, band, { source, player, status: 'CANCELLED' })
      if (source === 'BOT') {
        const leadHours = (startsAt.getTime() - cancelled.createdAt.getTime()) / HOUR
        const kind = !isPast
          ? 'CREDITED'
          : rand() < 0.4
            ? 'EXPIRED'
            : leadHours > 30 && chance(0.6)
              ? 'CREDITED'
              : 'FORFEITED'
        if (kind === 'EXPIRED') {
          cancelled.updatedAt = addMs(cancelled.paymentExpiresAt!, randInt(1, 5) * MINUTE)
        } else {
          markTransferDetected(cancelled, addMs(cancelled.createdAt, 4 * MINUTE))
          cancelled.status = 'CANCELLED'
          const latest = kind === 'CREDITED' ? addMs(startsAt, -26 * HOUR) : addMs(startsAt, -3 * HOUR)
          const earliest = addMs(cancelled.createdAt, 30 * MINUTE)
          const span = Math.max(0, minDate(latest, now).getTime() - earliest.getTime())
          cancelled.updatedAt = addMs(earliest, rand() * span)
          cancelled.depositOutcome =
            kind === 'CREDITED' && cancelled.updatedAt <= addMs(startsAt, -24 * HOUR) ? 'CREDITED' : 'FORFEITED'
          if (cancelled.depositOutcome === 'CREDITED' && player) player.creditCents += cancelled.transferAmountCents!
        }
      } else {
        cancelled.updatedAt = addMs(
          cancelled.createdAt,
          rand() * Math.max(0, startsAt.getTime() - cancelled.createdAt.getTime()) * 0.8,
        )
      }

      // The freed court is often resold (the waitlist and the bot's suggestions do that).
      if (chance(isPast ? 0.4 : 0.3)) {
        let buyer = pickPlayer()
        for (let retry = 0; retry < 5 && playsAt(buyer, startsAt); retry += 1) buyer = pickPlayer()
        book(court, dateKey, band, {
          source: 'BOT',
          player: buyer,
          createdAt: minDate(
            addMs(cancelled.updatedAt, randInt(5, 240) * MINUTE),
            addMs(minDate(startsAt, now), -40 * MINUTE),
          ),
        })
      }
    }

    // ── 4a. Turnos fijos ────────────────────────────────────────────────────
    const RECURRING_DEFS = [
      { weekday: 1, start: '20:00', court: 'c1', name: 'Pablo Ferreyra', notes: 'Grupo de los lunes', daysAgo: 70 },
      { weekday: 2, start: '21:30', court: 'c2', name: 'Gustavo Sánchez', notes: null, daysAgo: 66 },
      { weekday: 3, start: '18:30', court: 'c1', name: 'Marcos Aguirre', notes: 'Pagan los 4 por QR', daysAgo: 64 },
      { weekday: 4, start: '20:00', court: 'c3', name: 'Diego Romero', notes: null, daysAgo: 60 },
      { weekday: 5, start: '21:30', court: 'c1', name: 'Federico Molina', notes: 'Se quedan al buffet', daysAgo: 58 },
      {
        weekday: 1,
        start: '09:30',
        court: 'c4',
        name: 'Clase grupal · Prof. Nicolás Paz',
        notes: 'Clase de nivel intermedio',
        daysAgo: 70,
      },
      { weekday: 3, start: '11:00', court: 'c3', name: 'Clase damas · Prof. Valentina Ruiz', notes: null, daysAgo: 52 },
      {
        weekday: 6,
        start: '09:30',
        court: 'c4',
        name: 'Escuelita infantil · Prof. Nicolás Paz',
        notes: 'Chicos de 6 a 14 años',
        daysAgo: 45,
      },
      { weekday: 6, start: '17:00', court: 'c2', name: 'Hernán Castro', notes: null, daysAgo: 38 },
      { weekday: 2, start: '18:30', court: 'c3', name: 'Laura Giménez', notes: null, daysAgo: 30 },
      {
        weekday: 5,
        start: '18:30',
        court: 'c2',
        name: 'Agustina Peralta',
        notes: 'Hasta fin de año',
        daysAgo: 24,
        untilDays: 75,
      },
      {
        weekday: 4,
        start: '23:00',
        court: 'c2',
        name: 'Ezequiel Ortiz',
        notes: 'Pausado por lesión',
        daysAgo: 68,
        pausedDaysAgo: 18,
      },
    ]
    for (const [index, def] of RECURRING_DEFS.entries()) {
      const court = courtByKey[def.court]
      const createdAt = addMs(now, -def.daysAgo * DAY - randInt(1, 10) * HOUR)
      const sample =
        findBand(court, today, def.start) ??
        bandsForDate(court, shiftDateKey(today, 1)).find(b => b.start === def.start)!
      const untilKey = def.untilDays ? shiftDateKey(today, def.untilDays) : null
      const rb: SeedRecurring = {
        id: newId(),
        court,
        dayOfWeek: def.weekday,
        slotStart: def.start,
        slotEnd: sample.end,
        playerName: def.name,
        playerPhone: `5493410${String(900000 + index * 613).slice(-6)}`,
        priceCents: resolveBandPriceCents(
          court.baseCents,
          court.rules,
          shiftDateKey(today, (def.weekday - weekdayOfKey(today) + 7) % 7),
          def.start,
        ),
        notes: def.notes,
        untilDate: untilKey
          ? bandDateTimes(untilKey, { start: '00:00', end: '00:00', startOffset: 0, endOffset: 0 }).startsAt
          : null,
        isActive: !def.pausedDaysAgo,
        createdAt,
        updatedAt: def.pausedDaysAgo ? addMs(now, -def.pausedDaysAgo * DAY) : createdAt,
      }
      recurring.push(rb)

      const lastKey = def.pausedDaysAgo
        ? shiftDateKey(today, -def.pausedDaysAgo)
        : untilKey && untilKey < shiftDateKey(today, RECURRING_WEEKS_AHEAD * 7)
          ? untilKey
          : shiftDateKey(today, RECURRING_WEEKS_AHEAD * 7 - 1)
      const firstKey = [toDateKey(createdAt), shiftDateKey(today, -HISTORY_DAYS)].sort()[1]
      for (let key = firstKey; key <= lastKey; key = shiftDateKey(key, 1)) {
        if (weekdayOfKey(key) !== def.weekday) continue
        const band = findBand(court, key, def.start)
        if (!band || isTaken(court, bandDateTimes(key, band).startsAt)) continue
        const { startsAt } = bandDateTimes(key, band)
        if (startsAt <= createdAt) continue
        book(court, key, band, {
          source: 'RECURRING',
          playerName: rb.playerName,
          playerPhone: rb.playerPhone,
          priceCents: rb.priceCents,
          recurringBookingId: rb.id,
          createdAt: new Date(
            Math.max(createdAt.getTime(), startsAt.getTime() - RECURRING_WEEKS_AHEAD * 7 * DAY) + randInt(1, 30) * 1000,
          ),
        })
      }
    }

    // "El fijo de los martes no viene esta semana": a cancelled occurrence, freed for resale.
    const skipped = bookings
      .filter(
        b =>
          b.source === 'RECURRING' && b.recurringBookingId === recurring[1].id && b.slot.startsAt > addMs(now, 2 * DAY),
      )
      .sort((a, b) => a.slot.startsAt.getTime() - b.slot.startsAt.getTime())[0]
    if (skipped) {
      skipped.status = 'CANCELLED'
      skipped.notes = 'Avisaron que esta semana no vienen'
      skipped.updatedAt = addMs(now, -randInt(3, 20) * HOUR)
      skipped.slot.status = 'AVAILABLE'
    }

    // ── 4b. Story bookings (the ones the demo conversations talk about) ─────
    const d = (offset: number): string => shiftDateKey(today, offset)
    const storyPlayer = (index: number): SeedPlayer => {
      const p = players[index]
      p.inPool = false
      return p
    }
    // Sundays run on another grid (09:00, 10:30…): take the band closest to the wanted time.
    const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
    const nearBand = (court: SeedCourt, dateKey: string, start: string): ScheduleBand | undefined =>
      bandsForDate(court, dateKey).sort(
        (a, b) => Math.abs(minutesOf(a.start) - minutesOf(start)) - Math.abs(minutesOf(b.start) - minutesOf(start)),
      )[0]
    const firstFree = (
      courtKeys: string[],
      dateKey: string,
      start: string,
    ): { court: SeedCourt; band: ScheduleBand } => {
      for (const key of courtKeys) {
        const court = courtByKey[key]
        const band = nearBand(court, dateKey, start)
        if (band && !isTaken(court, bandDateTimes(dateKey, band).startsAt)) return { court, band }
      }
      throw new Error(`No free court for the story on ${dateKey} ${start}`)
    }

    const pendingA = storyPlayer(50)
    const pendingB = storyPlayer(51)
    const pendingC = storyPlayer(52)
    const confirmedToday = storyPlayer(53)
    const rescheduler = storyPlayer(54)
    const myTurns = storyPlayer(55)
    const faqPlayer = storyPlayer(56)
    const eventPlayer = storyPlayer(57)
    const advisorPlayer = storyPlayer(59)
    const pricePlayer = storyPlayer(61)
    const repeatPlayer = regulars[0]

    const story: Record<string, SeedBooking> = {}
    {
      const a = firstFree(['c3', 'c2', 'c1'], d(1), '20:00')
      story.pendingA = book(a.court, d(1), a.band, {
        source: 'BOT',
        player: pendingA,
        status: 'PENDING_PAYMENT',
        createdAt: addMs(anchor, -6 * MINUTE),
      })
      const b = firstFree(['c2', 'c1', 'c3'], d(2), '21:30')
      story.pendingB = book(b.court, d(2), b.band, {
        source: 'BOT',
        player: pendingB,
        status: 'PENDING_PAYMENT',
        createdAt: addMs(anchor, -4 * MINUTE),
      })
      const c = firstFree(['c1', 'c2', 'c3'], d(3), '18:30')
      story.pendingC = book(c.court, d(3), c.band, {
        source: 'BOT',
        player: pendingC,
        status: 'PENDING_PAYMENT',
        createdAt: addMs(anchor, -15 * MINUTE),
      })

      const p1 = firstFree(['c4', 'c3'], d(4), '20:00')
      story.panelPending1 = book(p1.court, d(4), p1.band, {
        source: 'PANEL',
        playerName: 'Federico Luna',
        playerPhone: '5493410773120',
        status: 'PENDING_PAYMENT',
        bookedByUserId: staffIds[0],
        createdAt: addMs(anchor, -3 * HOUR),
        notes: 'Cumple de Fede — pasa a dejar la seña en efectivo',
      })
      const p2 = firstFree(['c3', 'c2'], d(5), '21:30')
      story.panelPending2 = book(p2.court, d(5), p2.band, {
        source: 'PANEL',
        playerName: 'Rocío Maidana',
        playerPhone: '5493410660418',
        status: 'PENDING_PAYMENT',
        bookedByUserId: ownerId,
        createdAt: addMs(anchor, -20 * HOUR),
        notes: 'Reservó por teléfono, transfiere la seña hoy',
      })

      const conf = firstFree(['c1', 'c2', 'c3'], d(1), '21:30')
      story.confirmedToday = book(conf.court, d(1), conf.band, {
        source: 'BOT',
        player: confirmedToday,
        createdAt: addMs(anchor, -3 * HOUR - 8 * MINUTE),
      })
      markTransferDetected(story.confirmedToday, addMs(story.confirmedToday.createdAt, 4 * MINUTE))

      const moved = firstFree(['c3', 'c2', 'c1'], d(2), '18:30')
      story.rescheduled = book(moved.court, d(2), moved.band, {
        source: 'BOT',
        player: rescheduler,
        createdAt: addMs(anchor, -2 * DAY - 5 * HOUR),
      })
      story.rescheduled.rescheduleCount = 1
      story.rescheduled.updatedAt = addMs(anchor, -47 * MINUTE)

      const t1 = firstFree(['c2', 'c1', 'c3'], d(3), '20:00')
      story.myTurns1 = book(t1.court, d(3), t1.band, {
        source: 'BOT',
        player: myTurns,
        createdAt: addMs(anchor, -26 * HOUR),
      })
      const t2 = firstFree(['c1', 'c2', 'c3'], d(6), '18:30')
      story.myTurns2 = book(t2.court, d(6), t2.band, {
        source: 'BOT',
        player: myTurns,
        createdAt: addMs(anchor, -3 * DAY),
      })

      // The regular's "repetir": next occurrence of their habit, booked half an hour ago.
      let repeatKey = d(1)
      const repeatFree = (key: string): boolean =>
        weekdayOfKey(key) === 4 &&
        !isTaken(courtByKey.c2, bandDateTimes(key, findBand(courtByKey.c2, key, '20:00')!).startsAt)
      while (!repeatFree(repeatKey)) repeatKey = shiftDateKey(repeatKey, 1)
      const repeatBand = findBand(courtByKey.c2, repeatKey, '20:00')!
      story.repeat = book(courtByKey.c2, repeatKey, repeatBand, {
        source: 'BOT',
        player: repeatPlayer,
        createdAt: addMs(anchor, -32 * MINUTE),
      })
      markTransferDetected(story.repeat, addMs(story.repeat.createdAt, 6 * MINUTE))

      // Rebuilt at night: last evening's señas were paid long ago (unpaid ones would have expired).
      for (const pending of [story.pendingA, story.pendingB, story.pendingC]) {
        if (pending.paymentExpiresAt! <= addMs(now, 5 * MINUTE)) {
          markTransferDetected(pending, addMs(pending.createdAt, randInt(3, 12) * MINUTE))
        }
      }

      // Cancha 4 closed tomorrow morning for maintenance.
      for (const start of ['08:00', '09:30']) {
        const band = findBand(courtByKey.c4, d(1), start)
        if (!band || isTaken(courtByKey.c4, bandDateTimes(d(1), band).startsAt)) continue
        const slot = ensureSlot(
          courtByKey.c4,
          d(1),
          band,
          bandPrice(courtByKey.c4, d(1), band),
          addMs(anchor, -2 * DAY),
        )
        slot.status = 'BLOCKED'
      }
    }

    // ── 4c. Regulars on their habitual slot ─────────────────────────────────
    const HABITS = [
      { weekday: 4, start: '20:00', court: 'c2' },
      { weekday: 1, start: '21:30', court: 'c1' },
      { weekday: 2, start: '20:00', court: 'c1' },
      { weekday: 3, start: '20:00', court: 'c2' },
      { weekday: 4, start: '18:30', court: 'c1' },
      { weekday: 5, start: '20:00', court: 'c2' },
      { weekday: 6, start: '18:30', court: 'c1' },
      { weekday: 0, start: '18:00', court: 'c1' },
      { weekday: 1, start: '18:30', court: 'c2' },
      { weekday: 3, start: '21:30', court: 'c3' },
      { weekday: 2, start: '12:30', court: 'c3' },
      { weekday: 6, start: '11:00', court: 'c1' },
    ]
    for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset += 1) {
      const dateKey = d(offset)
      const weekday = weekdayOfKey(dateKey)
      HABITS.forEach((habit, index) => {
        if (habit.weekday !== weekday) return
        const p = offset <= 0 ? 0.78 : offset <= 7 ? 0.7 : 0.2
        if (!chance(p)) return
        const court = courtByKey[habit.court]
        const band = findBand(court, dateKey, habit.start)
        if (!band || isTaken(court, bandDateTimes(dateKey, band).startsAt)) return
        bookOrganic(court, dateKey, band, regulars[index], chance(0.85) ? 'BOT' : 'PANEL')
      })
    }

    // The story players the bot greets as returning customers have played here before.
    for (const p of [pendingB, rescheduler, myTurns, faqPlayer, eventPlayer, advisorPlayer]) {
      const target = randInt(2, 5)
      let added = 0
      for (let tries = 0; tries < 60 && added < target; tries += 1) {
        const dateKey = d(randInt(-HISTORY_DAYS + 1, -2))
        const court = pick(courts)
        const band = pick(bandsForDate(court, dateKey).filter(b => Number(b.start.slice(0, 2)) >= 17))
        if (!band || isTaken(court, bandDateTimes(dateKey, band).startsAt)) continue
        book(court, dateKey, band, { source: chance(0.8) ? 'BOT' : 'PANEL', player: p })
        added += 1
      }
    }

    // ── 4d. Everyone else: demand by band, weekday, court and growth ────────
    function demand(court: SeedCourt, dateKey: string, band: ScheduleBand, offset: number): number {
      const weekday = weekdayOfKey(dateKey)
      const hour = Number(band.start.slice(0, 2))
      let p: number
      if (weekday === 0) p = hour < 14 ? 0.6 : hour < 20 ? 0.7 : 0.35
      else if (weekday === 6) p = hour < 12 ? 0.55 : hour < 17 ? 0.5 : hour < 22 ? 0.78 : 0.5
      else if (hour < 12) p = 0.3
      else if (hour < 15) p = 0.24
      else if (hour < 17) p = 0.32
      else if (hour < 18) p = 0.58
      else if (hour < 23) p = band.start === '21:30' ? 0.9 : 0.94
      else p = weekday === 5 ? 0.65 : 0.45
      p *= court.demand
      if (offset < 0) p *= 0.8 + 0.2 * ((offset + HISTORY_DAYS) / HISTORY_DAYS)
      const { startsAt } = bandDateTimes(dateKey, band)
      if (startsAt > now) {
        const ahead = offset
        p *=
          ahead <= 0
            ? 0.98
            : ahead === 1
              ? 0.93
              : ahead === 2
                ? 0.84
                : ahead <= 4
                  ? 0.7
                  : ahead <= 7
                    ? 0.5
                    : ahead <= 13
                      ? 0.24
                      : 0.09
      }
      return Math.min(0.98, p)
    }

    for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset += 1) {
      const dateKey = d(offset)
      for (const court of courts) {
        for (const band of bandsForDate(court, dateKey)) {
          if (isTaken(court, bandDateTimes(dateKey, band).startsAt)) continue
          if (!chance(demand(court, dateKey, band, offset))) continue
          const startsAt = bandDateTimes(dateKey, band).startsAt
          let player = pickPlayer()
          for (let retry = 0; retry < 5 && playsAt(player, startsAt); retry += 1) player = pickPlayer()
          bookOrganic(court, dateKey, band, player, chance(0.72) ? 'BOT' : 'PANEL')
        }
      }
    }

    // ── 4e. Ausencias, a blocked player and the "seña total" warning ────────
    const pastConfirmed = (p: SeedPlayer): SeedBooking[] =>
      p.bookings.filter(b => b.status === 'CONFIRMED' && b.slot.endsAt < addMs(now, -DAY))
    const hasFuture = (p: SeedPlayer): boolean =>
      p.bookings.some(b => b.status !== 'CANCELLED' && b.slot.startsAt > now)

    const markNoShow = (b: SeedBooking): void => {
      b.noShowAt = addMs(b.slot.startsAt, randInt(20, 50) * MINUTE)
      b.player!.noShowCount += 1
    }
    // Fixed names so the demo script can point at them on any run.
    const rename = (p: SeedPlayer, name: string): void => {
      const other = players.find(o => o !== p && o.name === name)
      if (other) other.name = `${other.name.split(' ')[0]} ${pick(LAST_NAMES.filter(l => !name.endsWith(l)))}`
      for (const b of p.bookings) if (b.playerName === p.name) b.playerName = name
      p.name = name
    }
    const candidates = players.filter(p => p.inPool && p.weight === 1 && !hasFuture(p))
    const threeStrikes = candidates.find(p => pastConfirmed(p).length >= 3)
    if (threeStrikes) {
      pastConfirmed(threeStrikes).slice(-3).forEach(markNoShow)
      rename(threeStrikes, 'Ramiro Coria')
      threeStrikes.notes = 'Faltó 3 veces sin avisar. El bot ya le pide la seña completa.'
    }
    const blocked = candidates.find(p => p !== threeStrikes && pastConfirmed(p).length >= 2)
    if (blocked) {
      pastConfirmed(blocked).slice(-2).forEach(markNoShow)
      rename(blocked, 'Leandro Vera')
      blocked.isBlocked = true
      blocked.notes = 'Debe dos turnos. Hablar con Lucía antes de volver a reservarle.'
    }
    // A few scattered no-shows among the rest.
    for (const b of bookings) {
      if (
        b.player &&
        b.status === 'CONFIRMED' &&
        !b.noShowAt &&
        b.source !== 'RECURRING' &&
        b.slot.endsAt < now &&
        chance(0.008)
      )
        markNoShow(b)
    }
    regulars[1].notes = 'Prefiere la Cancha 1. Juega la liga de 5ta.'
    regulars[3].notes = 'Siempre pide pelotas nuevas.'
    regulars[6].notes = 'Organiza el americano mensual.'

    // ── 4f. Cuenta del turno: consumos, pagos por jugador, cierre ───────────
    const drinks = ['agua', 'agua', 'saborizada', 'gatorade', 'gatorade', 'coca', 'cerveza']
    function addConsumos(b: SeedBooking): void {
      const during = (): Date => addMs(b.slot.startsAt, randInt(5, 95) * MINUTE)
      if (chance(0.42)) b.lines.push(line(pick(['head', 'head', 'bull']), 1, 15, during()))
      const drinkCount = chance(0.6) ? randInt(1, 3) : 0
      const late = Number(b.band.start.slice(0, 2)) >= 21
      for (let i = 0; i < drinkCount; i += 1) {
        const key = late && chance(0.45) ? 'cerveza' : pick(drinks)
        b.lines.push(line(key, chance(0.25) ? 2 : 1, 1 << randInt(0, 3), during()))
      }
      if (chance(0.15)) b.lines.push(line(pick(['barrita', 'alfajor']), 1, 1 << randInt(0, 3), during()))
      if (chance(0.08)) b.lines.push(line('grip', 1, 1 << randInt(0, 3), during()))
      if (chance(0.08)) b.lines.push(line('paleta', 1, 1 << randInt(1, 3), during()))
    }
    function line(productKey: string, quantity: number, playerMask: number, createdAt: Date): SeedLine {
      return { productKey, quantity, unitPriceCents: productByKey[productKey].priceCents, playerMask, createdAt }
    }
    function owedByPlayer(b: SeedBooking): number[] {
      const owes = splitEqually(b.slot.priceCents, 4)
      for (const l of b.lines) {
        const members = [1, 2, 3, 4].filter(p => l.playerMask & (1 << (p - 1)))
        const shares = splitEqually(l.unitPriceCents * l.quantity, members.length)
        members.forEach((p, i) => (owes[p - 1] += shares[i]))
      }
      return owes
    }
    const depositPaid = (b: SeedBooking): number =>
      b.status === 'CONFIRMED' ? (b.transferAmountCents ?? 0) + b.creditAppliedCents : 0
    const method = (): 'CASH' | 'QR' | 'TRANSFER' => {
      const r = rand()
      return r < 0.35 ? 'CASH' : r < 0.75 ? 'QR' : 'TRANSFER'
    }

    /** Closes the bill: every player pays their part (or one pays it all at the desk). */
    function settle(b: SeedBooking, playersPaying = 4): void {
      const owes = owedByPlayer(b)
      const paidAt = (): Date => addMs(b.slot.startsAt, randInt(70, 100) * MINUTE)
      const total = owes.reduce((s, o) => s + o, 0)
      const credited = depositPaid(b)
      if (playersPaying === 4 && b.source !== 'RECURRING' && chance(0.35)) {
        b.localPaymentCents = Math.max(0, total - credited)
        b.localPaymentMethod = chance(0.5) ? 'CASH' : 'QR'
      } else {
        for (let slot = 1; slot <= playersPaying; slot += 1) {
          const remaining = owes[slot - 1] - (slot === 1 ? credited : 0)
          if (remaining > 0)
            b.payments.push({ playerSlot: slot, amountCents: remaining, method: method(), createdAt: paidAt() })
        }
      }
      const paid = b.payments.reduce((s, p) => s + p.amountCents, 0) + b.localPaymentCents + credited
      if (playersPaying === 4 && paid >= total && paid > 0) {
        const last = b.payments.reduce(
          (t, p) => (p.createdAt > t ? p.createdAt : t),
          addMs(b.slot.startsAt, 90 * MINUTE),
        )
        b.settledAt = minDate(last, addMs(now, -MINUTE))
      }
    }

    for (const b of bookings) {
      if (b.status !== 'CONFIRMED' || b.noShowAt) continue
      const ended = b.slot.endsAt <= now
      const inPlay = b.slot.startsAt <= now && !ended
      if (inPlay) {
        addConsumos(b)
        settle(b, randInt(0, 2))
      } else if (ended) {
        addConsumos(b)
        // The latest turnos of today are still being closed at the front desk.
        const justEnded = b.slot.endsAt > addMs(now, -70 * MINUTE)
        settle(b, justEnded && chance(0.6) ? randInt(1, 3) : 4)
      }
    }

    // Reminders: past ones were sent; future ones are marked so the cron never messages demo phones.
    for (const b of bookings) {
      if (b.status !== 'CONFIRMED' || !b.playerPhone) continue
      b.reminderSentAt = b.slot.startsAt <= now ? addMs(b.slot.startsAt, -60 * MINUTE) : now
    }

    // ── 4g. Conversations, written with the bot's real copy ─────────────────
    const sessions: SeedSession[] = []
    const freeBands = (dateKey: string, after: Date, alsoFree: SeedBooking): BandOption[] => {
      const byStart = new Map<string, BandOption>()
      for (const court of courts) {
        for (const band of bandsForDate(court, dateKey)) {
          const { startsAt, endsAt } = bandDateTimes(dateKey, band)
          if (startsAt <= after) continue
          const slot = slots.get(slotKey(court.id, startsAt))
          const free = !slot || slot.status === 'AVAILABLE' || slot === alsoFree.slot
          if (!free) continue
          const option = byStart.get(band.start) ?? {
            bandStart: band.start,
            label: formatTimeRange(startsAt, endsAt),
            courts: [],
          }
          option.courts.push({ id: court.id, name: court.name, price: bandPrice(court, dateKey, band) })
          byStart.set(band.start, option)
        }
      }
      return [...byStart.values()].sort((a, b) => a.bandStart.localeCompare(b.bandStart))
    }
    const ctxFor = (b: SeedBooking, name: string): SessionContext => ({
      selectedDate: b.dateKey,
      selectedCourtName: b.court.name,
      selectedSlotLabel: formatTimeRange(b.slot.startsAt, b.slot.endsAt),
      selectedSlotPrice: b.slot.priceCents,
      playerName: name,
      playerDni: b.player?.dni,
    })
    const dayAsked = (dateKey: string, at: Date): string => {
      const diff = Math.round((Date.parse(dateKey) - Date.parse(toDateKey(at))) / DAY)
      if (diff === 0) return pick(['hoy', 'para hoy'])
      if (diff === 1) return pick(['mañana', 'para mañana', 'mañana a la noche'])
      return pick([
        `el ${dayLabelFromKey(dateKey).split(' ')[0]}`,
        `para el ${dayLabelFromKey(dateKey)}`,
        formatDayMonth(bandDateTimes(dateKey, { start: '12:00', end: '12:00', startOffset: 0, endOffset: 0 }).startsAt),
      ])
    }
    const timeAsked = (start: string): string => {
      const [h, m] = start.split(':')
      return m === '00'
        ? pick([`a las ${Number(h)}`, `${start}`, `las ${Number(h)} puede ser?`])
        : pick([`${start}`, `a las ${Number(h)} y media`])
    }

    /** A conversation that books `b` end to end, starting at `start`. */
    function bookingFlow(
      b: SeedBooking,
      start: Date,
      opts: { known: boolean; claim?: boolean; thanks?: boolean },
    ): SeedMessage[] {
      const p = b.player!
      return bookingConversation({
        rand,
        start,
        known: opts.known,
        playerName: p.name,
        dni: p.dni,
        dateKey: b.dateKey,
        startsAt: b.slot.startsAt,
        endsAt: b.slot.endsAt,
        bandStart: b.band.start,
        courtName: b.court.name,
        priceCents: b.slot.priceCents,
        transferAmountCents: b.transferAmountCents!,
        freeBands: freeBands(b.dateKey, addMs(start, MINUTE), b),
        alias,
        holder,
        welcomeExtra: WELCOME_EXTRA,
        claim: opts.claim,
        thanks: opts.thanks,
      })
    }

    function addSession(
      p: SeedPlayer | null,
      waId: string,
      name: string | null,
      messages: SeedMessage[],
      extra: Partial<SeedSession> = {},
    ): void {
      const history = messages
        .filter(m => m.role !== 'ADMIN')
        .slice(-8)
        .map(m => ({ role: m.role === 'USER' ? ('user' as const) : ('assistant' as const), content: m.content }))
      const firstBooking = p?.bookings.reduce<Date | null>(
        (min, b) => (!min || b.createdAt < min ? b.createdAt : min),
        null,
      )
      sessions.push({
        id: newId(),
        waId,
        playerName: name,
        state: 'MENU',
        mode: 'AI',
        needsAdvisor: false,
        context: { playerName: name ?? undefined, playerDni: p?.dni, history },
        messages,
        createdAt: minDate(firstBooking ?? messages[0].createdAt, messages[0].createdAt),
        ...extra,
      })
    }

    const flowStart = (b: SeedBooking, msgsBefore: number): Date => addMs(b.createdAt, -msgsBefore * 1000)

    // Pending, waiting for the transfer (the countdown is live in Pagos).
    addSession(
      pendingA,
      pendingA.phone,
      pendingA.name,
      bookingFlow(story.pendingA, flowStart(story.pendingA, 240), { known: false }),
    )
    addSession(
      pendingB,
      pendingB.phone,
      firstName(pendingB),
      bookingFlow(story.pendingB, flowStart(story.pendingB, 150), { known: true, claim: true }).filter(
        m => m.createdAt <= anchor,
      ),
    )
    // Booked, paid and thanked three hours ago.
    addSession(
      confirmedToday,
      confirmedToday.phone,
      confirmedToday.name,
      bookingFlow(story.confirmedToday, flowStart(story.confirmedToday, 240), { known: false, thanks: true }),
    )

    // The regular who just answers "repetir".
    {
      const b = story.repeat
      const t0 = addMs(b.createdAt, -70 * 1000)
      const name = firstName(repeatPlayer)
      const hint = `\n\n💡 ¿Repetís lo de siempre? *jueves 20:00* en *${b.court.name}* — respondé *repetir* y te lo reservo.`
      const msgs: SeedMessage[] = [
        { role: 'USER', content: 'hola!', createdAt: t0 },
        { role: 'BOT', content: `${welcome(name)}\n\n${WELCOME_EXTRA}${hint}`, createdAt: addMs(t0, 3000) },
        { role: 'USER', content: 'repetir', createdAt: addMs(t0, 50_000) },
        { role: 'BOT', content: confirmBooking(ctxFor(b, name)), createdAt: addMs(t0, 53_000) },
        { role: 'USER', content: 'dale', createdAt: addMs(t0, 68_000) },
        {
          role: 'BOT',
          content: transferPending(ctxFor(b, name), { alias, holder }, b.transferAmountCents!, 'DEPOSIT', true, 'AUTO'),
          createdAt: addMs(t0, 71_000),
        },
        { role: 'USER', content: 'Listo 👌', createdAt: addMs(t0, 330_000) },
        {
          role: 'BOT',
          content: paymentClaimAck(b.court.name, b.slot.startsAt, b.slot.endsAt, b.transferAmountCents),
          createdAt: addMs(t0, 333_000),
        },
      ]
      addSession(repeatPlayer, repeatPlayer.phone, name, msgs)
    }

    // Moving a booking to another day — the deposit keeps counting.
    {
      const b = story.rescheduled
      const name = firstName(rescheduler)
      const oldKey = d(1)
      const oldBand = nearBand(b.court, oldKey, b.band.start)!
      const old = bandDateTimes(oldKey, oldBand)
      const oldLabel = `${dayLabelFromKey(oldKey)} · ${formatTimeRange(old.startsAt, old.endsAt)} · ${b.court.name}`
      const priceDiff = b.slot.priceCents - bandPrice(b.court, oldKey, oldBand)
      const t0 = addMs(anchor, -52 * MINUTE)
      const at = (s: number): Date => addMs(t0, s * 1000)
      const ctx = ctxFor(b, name)
      const msgs: SeedMessage[] = [
        { role: 'USER', content: 'Hola! Mañana no llego, se puede pasar el turno para otro día?', createdAt: at(0) },
        {
          role: 'BOT',
          content: myBookingsList([
            { id: b.id, label: oldLabel, short: '', bandStart: b.band.start, courtName: b.court.name, pending: false },
          ]),
          createdAt: at(3),
        },
        { role: 'USER', content: oldLabel, createdAt: at(25) },
        { role: 'BOT', content: askRescheduleDate(oldLabel), createdAt: at(28) },
        { role: 'USER', content: dayAsked(b.dateKey, at(28)), createdAt: at(60) },
        { role: 'BOT', content: dayAvailabilityList(freeBands(b.dateKey, at(60), b), b.dateKey), createdAt: at(63) },
        { role: 'USER', content: timeAsked(b.band.start), createdAt: at(110) },
        { role: 'BOT', content: rescheduleConfirm(oldLabel, ctx, priceDiff), createdAt: at(113) },
        { role: 'USER', content: 'sí, dale', createdAt: at(130) },
        { role: 'BOT', content: rescheduleDone(ctx, priceDiff), createdAt: at(133) },
        { role: 'USER', content: 'Genial, gracias!', createdAt: at(170) },
        { role: 'BOT', content: thanksReply(name), createdAt: at(172) },
      ]
      addSession(rescheduler, rescheduler.phone, name, msgs)
    }

    // "Mis turnos": a returning player checking what they have booked.
    {
      const name = firstName(myTurns)
      const t0 = addMs(anchor, -100 * MINUTE)
      const at = (s: number): Date => addMs(t0, s * 1000)
      const label = (b: SeedBooking): string =>
        `${dayLabelFromKey(b.dateKey)} · ${formatTimeRange(b.slot.startsAt, b.slot.endsAt)} · ${b.court.name}`
      const msgs: SeedMessage[] = [
        { role: 'USER', content: 'Hola', createdAt: at(0) },
        { role: 'BOT', content: `${welcome(name)}\n\n${WELCOME_EXTRA}`, createdAt: at(3) },
        { role: 'USER', content: '2', createdAt: at(20) },
        {
          role: 'BOT',
          content: myBookingsList(
            [story.myTurns1, story.myTurns2].map(b => ({
              id: b.id,
              label: label(b),
              short: '',
              bandStart: b.band.start,
              courtName: b.court.name,
              pending: false,
            })),
          ),
          createdAt: at(23),
        },
        { role: 'USER', content: 'Nada, era para chequear 👍 gracias', createdAt: at(60) },
        { role: 'BOT', content: thanksReply(name), createdAt: at(62) },
      ]
      addSession(myTurns, myTurns.phone, name, msgs)
    }

    // A question answered from the club's FAQ.
    {
      const name = firstName(faqPlayer)
      const t0 = addMs(anchor, -26 * MINUTE)
      const at = (s: number): Date => addMs(t0, s * 1000)
      const msgs: SeedMessage[] = [
        {
          role: 'USER',
          content: 'Buenas! Tienen estacionamiento? Y se puede alquilar paleta? Voy con un amigo que no tiene',
          createdAt: at(0),
        },
        {
          role: 'BOT',
          content:
            `¡Hola, ${name}! 🙌 Sí, tenemos estacionamiento propio y gratuito para clientes, con entrada por la calle lateral.\n\n` +
            `Y sí, alquilamos paletas a *$6.000* por turno: pedila en recepción cuando llegues. 🎾\n\n${MENU}`,
          createdAt: at(4),
        },
        { role: 'USER', content: 'Bárbaro, gracias!!', createdAt: at(45) },
        { role: 'BOT', content: thanksReply(name), createdAt: at(47) },
      ]
      addSession(faqPlayer, faqPlayer.phone, name, msgs)
    }

    // Prices for Saturday night, before deciding.
    {
      const t0 = addMs(anchor, -4 * HOUR - 12 * MINUTE)
      const at = (s: number): Date => addMs(t0, s * 1000)
      const priceLine = (keys: string[], label: string): string =>
        `• ${label} — $${(courtByKey[keys[0]].primeCents / 100).toLocaleString('es-AR')}`
      const msgs: SeedMessage[] = [
        { role: 'USER', content: 'Hola, cuánto sale la cancha el sábado a la noche?', createdAt: at(0) },
        {
          role: 'BOT',
          content:
            `🎾 El sábado a la noche (18:30, 20:00 y 21:30) las canchas salen:\n\n` +
            `${priceLine(['c1'], 'Cancha 1 y 2 · Panorámica')}\n${priceLine(['c3'], 'Cancha 3 · Blindex')}\n${priceLine(['c4'], 'Cancha 4 · Descubierta')}\n\n` +
            `Para reservar se abona una seña del ${DEPOSIT_PERCENT}% por transferencia y el resto en el club. ¿Querés que te busque lugar?`,
          createdAt: at(4),
        },
        { role: 'USER', content: 'Dale, lo hablo con los chicos y te escribo', createdAt: at(80) },
        { role: 'BOT', content: thanksReply(), createdAt: at(82) },
      ]
      addSession(pricePlayer, pricePlayer.phone, null, msgs)
    }

    // Handed to a human: a company tournament, already being answered by the owner.
    {
      const name = firstName(eventPlayer)
      const t0 = addMs(anchor, -2 * HOUR - 5 * MINUTE)
      const at = (s: number): Date => addMs(t0, s * 1000)
      let saturday = d(7)
      while (weekdayOfKey(saturday) !== 6) saturday = shiftDateKey(saturday, 1)
      const satDay = Number(saturday.slice(8))
      const msgs: SeedMessage[] = [
        {
          role: 'USER',
          content: `Hola! Queremos armar un torneo para la empresa, somos 16. Se puede un sábado a la tarde?`,
          createdAt: at(0),
        },
        {
          role: 'BOT',
          content:
            `¡Qué buen plan! 🙌 Armamos eventos de empresa con canchas + buffet. Para coordinar fecha y presupuesto lo mejor es hablar con el equipo del club. ` +
            `Si querés, escribime *quiero hablar con una persona* y te paso con ellos. 🎾`,
          createdAt: at(4),
        },
        { role: 'USER', content: 'Sí, quiero hablar con una persona', createdAt: at(40) },
        {
          role: 'BOT',
          content: 'Dale 🙌 Aviso al equipo del club para que te atiendan por acá. En un ratito te responden. 🎾',
          createdAt: at(42),
        },
        {
          role: 'ADMIN',
          content: `¡Hola ${name}! Soy Lucía, de Distrito 😊 Para 16 personas te podemos dar las 4 canchas el sábado de 14 a 18 h, con buffet al final. ¿Qué sábado tenían en mente?`,
          createdAt: at(380),
        },
        { role: 'USER', content: `El sábado ${satDay} estaría bárbaro`, createdAt: at(900) },
        {
          role: 'ADMIN',
          content: `Perfecto, te lo dejo bloqueado. En un rato te paso el presupuesto por acá 🙌`,
          createdAt: at(1020),
        },
        { role: 'USER', content: 'Genial, muchas gracias Lucía!', createdAt: at(1100) },
      ]
      addSession(eventPlayer, eventPlayer.phone, name, msgs, { mode: 'HUMAN', state: 'MENU' })
    }

    // Asked for a person and nobody answered yet → "Pide asesor".
    {
      const name = firstName(advisorPlayer)
      const t0 = addMs(anchor, -14 * MINUTE)
      const at = (s: number): Date => addMs(t0, s * 1000)
      const msgs: SeedMessage[] = [
        { role: 'USER', content: 'Hola, dan clases para chicos? Mi hijo tiene 10 años', createdAt: at(0) },
        {
          role: 'BOT',
          content:
            `¡Hola, ${name}! 🙌 Sí: tenemos escuelita para chicos de 6 a 14 años los *sábados a las 9:30 h*, con el profe Nicolás. ` +
            `Los precios los pasan en recepción. 🎾`,
          createdAt: at(4),
        },
        { role: 'USER', content: 'Bárbaro. Quiero hablar con alguien para inscribirlo', createdAt: at(70) },
        {
          role: 'BOT',
          content: 'Dale 🙌 Aviso al equipo del club para que te atiendan por acá. En un ratito te responden. 🎾',
          createdAt: at(72),
        },
      ]
      addSession(advisorPlayer, advisorPlayer.phone, name, msgs, { mode: 'HUMAN', needsAdvisor: true })
    }

    // Older chats: bot bookings from the past days.
    const olderBotBookings = bookings
      .filter(
        b =>
          b.source === 'BOT' &&
          b.status === 'CONFIRMED' &&
          b.player?.inPool &&
          b.createdAt < addMs(now, -DAY) &&
          b.createdAt > addMs(now, -6 * DAY),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const usedWaIds = new Set(sessions.map(s => s.waId))
    const usedFirstNames = new Set(sessions.map(s => (s.playerName ?? '').split(' ')[0]))
    for (const b of olderBotBookings) {
      if (sessions.length >= 20) break
      const first = firstName(b.player!)
      if (usedWaIds.has(b.player!.phone) || usedFirstNames.has(first)) continue
      usedWaIds.add(b.player!.phone)
      usedFirstNames.add(first)
      const known = b.player!.bookings.some(o => o.createdAt < b.createdAt)
      const msgs = bookingFlow(b, flowStart(b, known ? 150 : 240), { known, claim: chance(0.5), thanks: chance(0.4) })
      addSession(b.player, b.player!.phone, known ? firstName(b.player!) : b.player!.name, msgs)
    }

    // ── 5. Persist ──────────────────────────────────────────────────────────
    const chunked = async <T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> => {
      for (let i = 0; i < rows.length; i += 400) await insert(rows.slice(i, i + 400))
    }

    await prisma.court.createMany({
      data: courts.map(c => ({
        id: c.id,
        clubId,
        name: c.name,
        priceCents: c.baseCents,
        openTime: c.openTime,
        closeTime: c.closeTime,
        slotDurationMinutes: c.slotDurationMinutes,
        weeklyHours: c.weeklyHours as object,
        courtType: c.courtType,
        createdAt: addMs(clubCreatedAt, DAY),
      })),
    })
    await prisma.courtPriceRule.createMany({
      data: courts.flatMap(c =>
        c.rules.map(r => ({
          id: newId(),
          clubId,
          courtId: c.id,
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime,
          priceCents: r.priceCents,
        })),
      ),
    })
    await prisma.product.createMany({
      data: products.map(p => ({
        id: p.id,
        clubId,
        name: p.name,
        priceCents: p.priceCents,
        category: p.category,
        isActive: p.isActive,
        createdAt: addMs(clubCreatedAt, 2 * DAY),
      })),
    })

    const linkedPlayers = players.filter(
      p => p.bookings.some(b => b.player === p) || sessions.some(s => s.waId === p.phone),
    )
    await prisma.player.createMany({
      data: linkedPlayers.map(p => {
        const dates = p.bookings.map(b => b.createdAt.getTime())
        const sessionDates = sessions
          .filter(s => s.waId === p.phone)
          .flatMap(s => s.messages.map(m => m.createdAt.getTime()))
        const all = [...dates, ...sessionDates]
        const paidOnce = p.bookings.some(b => b.mpPaymentId)
        return {
          id: p.id,
          clubId,
          phone: p.phone,
          name: p.name,
          dni: p.bookings.some(b => b.source === 'BOT') ? p.dni : null,
          payerMpUserId: paidOnce ? p.mpUserId : null,
          noShowCount: p.noShowCount,
          creditCents: p.creditCents,
          isBlocked: p.isBlocked,
          notes: p.notes,
          createdAt: new Date(Math.min(...all)),
          updatedAt: new Date(Math.max(...dates, ...(dates.length ? [] : all))),
        }
      }),
    })

    await prisma.recurringBooking.createMany({
      data: recurring.map(rb => ({
        id: rb.id,
        clubId,
        courtId: rb.court.id,
        dayOfWeek: rb.dayOfWeek,
        slotStart: rb.slotStart,
        slotEnd: rb.slotEnd,
        playerName: rb.playerName,
        playerPhone: rb.playerPhone,
        priceCents: rb.priceCents,
        notes: rb.notes,
        untilDate: rb.untilDate,
        isActive: rb.isActive,
        createdByUserId: ownerId,
        createdAt: rb.createdAt,
        updatedAt: rb.updatedAt,
      })),
    })

    await chunked([...slots.values()], chunk =>
      prisma.slot.createMany({
        data: chunk.map(s => ({
          id: s.id,
          clubId,
          courtId: s.courtId,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          priceCents: s.priceCents,
          status: s.status,
          createdAt: s.createdAt,
          updatedAt: s.createdAt,
        })),
      }),
    )

    const linkedIds = new Set(linkedPlayers.map(p => p.id))
    await chunked(bookings, chunk =>
      prisma.booking.createMany({
        data: chunk.map(b => ({
          id: b.id,
          clubId,
          slotId: b.slot.id,
          playerName: b.playerName,
          playerPhone: b.playerPhone,
          playerId: b.player && linkedIds.has(b.player.id) ? b.player.id : null,
          noShowAt: b.noShowAt,
          creditAppliedCents: b.creditAppliedCents,
          depositOutcome: b.depositOutcome,
          localPaymentCents: b.localPaymentCents,
          localPaymentMethod: b.localPaymentMethod,
          playerDni: b.playerDni,
          status: b.status,
          notes: b.notes,
          payerCuit: b.payerCuit,
          payerMpUserId: b.payerMpUserId,
          bookedByUserId: b.bookedByUserId,
          recurringBookingId: b.recurringBookingId,
          depositCents: b.depositCents,
          transferAmountCents: b.transferAmountCents,
          mpPaymentId: b.mpPaymentId,
          paymentExpiresAt: b.paymentExpiresAt,
          settledAt: b.settledAt,
          reminderSentAt: b.reminderSentAt,
          rescheduleCount: b.rescheduleCount,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        })),
      }),
    )
    await chunked(
      bookings.flatMap(b => b.lines.map(l => ({ b, l }))),
      chunk =>
        prisma.bookingProduct.createMany({
          data: chunk.map(({ b, l }) => ({
            id: newId(),
            clubId,
            bookingId: b.id,
            productId: productByKey[l.productKey].id,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            playerMask: l.playerMask,
            createdAt: l.createdAt,
          })),
        }),
    )
    await chunked(
      bookings.flatMap(b => b.payments.map(p => ({ b, p }))),
      chunk =>
        prisma.bookingPlayerPayment.createMany({
          data: chunk.map(({ b, p }) => ({
            id: newId(),
            clubId,
            bookingId: b.id,
            playerSlot: p.playerSlot,
            amountCents: p.amountCents,
            method: p.method,
            createdAt: p.createdAt,
          })),
        }),
    )

    await prisma.conversationSession.createMany({
      data: sessions.map(s => {
        const last = s.messages[s.messages.length - 1].createdAt
        return {
          id: s.id,
          clubId,
          waId: s.waId,
          state: s.state,
          context: s.context as object,
          expiresAt: addMs(last, 30 * MINUTE),
          mode: s.mode,
          needsAdvisor: s.needsAdvisor,
          playerName: s.playerName,
          createdAt: s.createdAt,
          updatedAt: last,
        }
      }),
    })
    await chunked(
      sessions.flatMap(s => s.messages.map(m => ({ s, m }))),
      chunk =>
        prisma.conversationMessage.createMany({
          data: chunk.map(({ s, m }) => ({
            id: newId(),
            sessionId: s.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          })),
        }),
    )

    // What the bot cost per day (only the ops console reads it).
    const botByDay = new Map<string, number>()
    for (const b of bookings) {
      if (b.source !== 'BOT') continue
      const key = toDateKey(b.createdAt)
      botByDay.set(key, (botByDay.get(key) ?? 0) + 1)
    }
    const llmRows: Array<{
      id: string
      clubId: string
      dateKey: string
      calls: number
      inputTokens: number
      outputTokens: number
      costMicroUsd: number
    }> = []
    for (let offset = -HISTORY_DAYS; offset <= 0; offset += 1) {
      const dateKey = d(offset)
      const calls = (botByDay.get(dateKey) ?? 0) * randInt(4, 7) + randInt(8, 25)
      const inputTokens = calls * randInt(2300, 2900)
      const outputTokens = calls * randInt(130, 190)
      llmRows.push({
        id: newId(),
        clubId,
        dateKey,
        calls,
        inputTokens,
        outputTokens,
        costMicroUsd: Math.round(inputTokens * 0.15 + outputTokens * 0.6),
      })
    }
    await prisma.llmUsageDaily.createMany({ data: llmRows })

    // Prices: a +10% applied at the start of last month, and a +8% scheduled for next month.
    const [year, month] = today.split('-').map(Number)
    const monthKey = (y: number, m: number): string => {
      const date = new Date(Date.UTC(y, m - 1, 1))
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
    }
    const lastMonthKey = monthKey(year, month - 1)
    await prisma.scheduledPriceAdjustment.createMany({
      data: [
        {
          id: newId(),
          clubId,
          percent: 10,
          effectiveDateKey: lastMonthKey,
          appliedAt: bandDateTimes(lastMonthKey, { start: '00:10', end: '00:10', startOffset: 0, endOffset: 0 })
            .startsAt,
          createdAt: addMs(now, -45 * DAY),
        },
        {
          id: newId(),
          clubId,
          percent: 8,
          effectiveDateKey: monthKey(year, month + 1),
          appliedAt: null,
          createdAt: addMs(now, -2 * DAY),
        },
      ],
    })

    // ── 6. Summary ──────────────────────────────────────────────────────────
    const count = (filter: (b: SeedBooking) => boolean): number => bookings.filter(filter).length
    return {
      clubId,
      passwordUpdated: !!passwordHash,
      courts: courts.length,
      products: products.length,
      players: linkedPlayers.length,
      recurring: recurring.length,
      bookings: {
        total: bookings.length,
        confirmed: count(b => b.status === 'CONFIRMED'),
        pending: count(b => b.status === 'PENDING_PAYMENT'),
        cancelled: count(b => b.status === 'CANCELLED'),
      },
      todayConfirmed: count(b => b.dateKey === today && b.status === 'CONFIRMED'),
      conversations: sessions.length,
      consumos: bookings.reduce((sum, b) => sum + b.lines.length, 0),
      payments: bookings.reduce((sum, b) => sum + b.payments.length, 0),
    }
  }
}

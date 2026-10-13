import {
  dayLabelFromKey,
  formatDayMonth,
  formatTimeRange,
  toDateKey,
  wallTimeToUtc,
} from '../../availability/lib/datetime'
import {
  ASK_DATE,
  ASK_NAME,
  confirmBooking,
  courtsAtTimeList,
  dayAvailabilityList,
  DNI_NOTED,
  paymentClaimAck,
  receiptLinkedAck,
  thanksReply,
  transferPending,
  welcome,
} from '../../bot/messages'
import { BandOption, SessionContext } from '../../bot/types'

export interface DemoMessage {
  role: 'USER' | 'BOT' | 'ADMIN'
  content: string
  createdAt: Date
}

/** Everything a demo booking chat needs, so the seed and the live simulator write the same thing. */
export interface BookingConversationInput {
  rand: () => number
  /** When the player's first message arrives. */
  start: Date
  /** A returning player: the bot greets them by name and doesn't ask name/DNI again. */
  known: boolean
  playerName: string
  dni: string
  dateKey: string
  startsAt: Date
  endsAt: Date
  bandStart: string
  courtName: string
  priceCents: number
  transferAmountCents: number
  /** The day's free bands as the bot would list them (the booked one included). */
  freeBands: BandOption[]
  alias: string
  holder: string | null
  welcomeExtra: string | null
  /** The player says "ya transferí" afterwards. */
  claim?: boolean
  /** The player thanks the bot after the payment was confirmed. */
  thanks?: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A booking chat end to end (greeting → day → time → court → name → transfer data → DNI or receipt), built
 * from the bot's real copy in `bot/messages.ts` so the demo reads exactly like the product.
 */
export function bookingConversation(input: BookingConversationInput): DemoMessage[] {
  const { rand } = input
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]
  const between = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1))

  const msgs: DemoMessage[] = []
  let t = input.start
  const say = (role: DemoMessage['role'], content: string, gapSeconds: number): void => {
    t = new Date(t.getTime() + gapSeconds * 1000)
    msgs.push({ role, content, createdAt: t })
  }

  const firstName = input.playerName.split(' ')[0]
  const name = input.known ? firstName : input.playerName
  const ctx: SessionContext = {
    selectedDate: input.dateKey,
    selectedCourtName: input.courtName,
    selectedSlotLabel: formatTimeRange(input.startsAt, input.endsAt),
    selectedSlotPrice: input.priceCents,
    playerName: name,
    playerDni: input.dni,
  }
  const courtNumber = input.courtName.split(' ')[1]
  const extra = input.welcomeExtra ? `\n\n${input.welcomeExtra}` : ''

  say('USER', pick(['Hola!', 'Buenas', 'hola 👋', 'Hola, quería reservar una cancha']), 0)
  say('BOT', `${welcome(input.known ? name : undefined)}${extra}`, 3)
  say('USER', pick(['1', 'Reservar un turno', 'quiero reservar']), between(8, 40))
  say('BOT', ASK_DATE, 2)
  say('USER', dayAsked(input.dateKey, t, pick), between(10, 60))
  say('BOT', dayAvailabilityList(input.freeBands, input.dateKey), 3)
  say('USER', timeAsked(input.bandStart, pick), between(15, 90))
  const atTime = input.freeBands.find(o => o.bandStart === input.bandStart)
  if (atTime && atTime.courts.length > 1) {
    say(
      'BOT',
      courtsAtTimeList(
        atTime.courts.map(c => ({ name: c.name, price: c.price })),
        atTime.label,
        input.dateKey,
      ),
      2,
    )
    say('USER', pick([`la ${courtNumber}`, input.courtName, `la ${courtNumber} porfa`]), between(8, 40))
  }
  if (!input.known) {
    say('BOT', ASK_NAME, 2)
    say('USER', input.playerName, between(6, 25))
  }
  say('BOT', confirmBooking(ctx), 2)
  say('USER', pick(['Sí, confirmo', 'dale', 'sí!', 'Perfecto, confirmá']), between(6, 30))
  // The bot never blocks the booking on the DNI: a returning player's is reused, a new one is
  // asked for their DNI or the receipt photo in the transfer message, and sends it afterwards.
  say(
    'BOT',
    transferPending(
      input.known ? ctx : { ...ctx, playerDni: undefined },
      { alias: input.alias, holder: input.holder },
      input.transferAmountCents,
      'DEPOSIT',
      true,
      'AUTO',
    ),
    3,
  )
  if (!input.known) {
    if (rand() < 0.55) {
      say('USER', input.dni, between(20, 60))
      say('BOT', DNI_NOTED, 2)
    } else {
      say('USER', '[Imagen / comprobante recibido]', between(90, 200))
      say('BOT', receiptLinkedAck(input.courtName, input.startsAt, input.endsAt, null), 4)
    }
  }
  if (input.claim && input.known) {
    say('USER', pick(['listo, ya transferí', 'Ya está la transferencia 👍', 'transferido!']), between(90, 200))
    say('BOT', paymentClaimAck(input.courtName, input.startsAt, input.endsAt, input.transferAmountCents), 2)
  }
  if (input.thanks) {
    say('USER', pick(['Buenísimo, gracias!', 'genial gracias!!', 'Gracias 🙌']), between(240, 500))
    say('BOT', thanksReply(name), 2)
  }
  return msgs
}

/** How a player names the day: "mañana", "el jueves", "15/10"… */
function dayAsked(dateKey: string, at: Date, pick: <T>(items: readonly T[]) => T): string {
  const diff = Math.round((Date.parse(dateKey) - Date.parse(toDateKey(at))) / DAY_MS)
  if (diff === 0) return pick(['hoy', 'para hoy'])
  if (diff === 1) return pick(['mañana', 'para mañana', 'mañana a la noche'])
  return pick([
    `el ${dayLabelFromKey(dateKey).split(' ')[0]}`,
    `para el ${dayLabelFromKey(dateKey)}`,
    formatDayMonth(wallTimeToUtc(dateKey, '12:00')),
  ])
}

/** How a player names the time: "a las 20", "21:30", "a las 18 y media"… */
function timeAsked(start: string, pick: <T>(items: readonly T[]) => T): string {
  const [h, m] = start.split(':')
  return m === '00'
    ? pick([`a las ${Number(h)}`, start, `las ${Number(h)} puede ser?`])
    : pick([start, `a las ${Number(h)} y media`])
}

/** Session context the bot would leave after the chat: name, DNI and the last 8 turns. */
export function sessionContextFor(
  messages: DemoMessage[],
  playerName: string | null,
  dni: string | undefined,
): SessionContext {
  const history = messages
    .filter(m => m.role !== 'ADMIN')
    .slice(-8)
    .map(m => ({ role: m.role === 'USER' ? ('user' as const) : ('assistant' as const), content: m.content }))
  return { playerName: playerName ?? undefined, playerDni: dni, history }
}

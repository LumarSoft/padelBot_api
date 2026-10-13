import { BotService } from './bot.service'
import { BAD_DNI } from './messages'

/**
 * The bot side of the hybrid: a readable receipt photo stores who paid on the pending booking
 * (without confirming anything), and the DNI at booking is optional — "otro" means someone
 * else pays and the receipt will identify them.
 */

const WA_ID = '5493411234567'
const CLUB = 'club-1'
const PENDING = {
  id: 'b1',
  transferAmountCents: 1050000,
  slot: {
    startsAt: new Date('2026-10-14T21:00:00Z'),
    endsAt: new Date('2026-10-14T22:30:00Z'),
    court: { name: 'Cancha 1' },
  },
}

function setup(reading: unknown) {
  const bookings = {
    findActivePendingForPlayer: jest.fn().mockResolvedValue(PENDING),
    recordReceiptReading: jest.fn().mockResolvedValue(undefined),
  }
  const llm = { readTransferReceipt: jest.fn().mockResolvedValue(reading) }
  const media = { download: jest.fn().mockResolvedValue({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' }) }
  const prisma = {
    club: {
      findUnique: jest.fn().mockResolvedValue({
        transferAlias: 'club.alias',
        transferHolder: null,
        depositMode: 'DEPOSIT',
        requireDniMatch: true,
        paymentVerificationMode: 'AUTO',
      }),
    },
  }
  const service = new BotService(
    prisma as never,
    bookings as never,
    {} as never,
    {} as never,
    llm as never,
    media as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { service, bookings }
}

const acknowledge = (service: BotService) =>
  (
    service as unknown as { acknowledgeReceipt: (c: string, w: string, m: unknown) => Promise<string> }
  ).acknowledgeReceipt(CLUB, WA_ID, { mediaId: 'i1', mimeType: 'image/jpeg', phoneNumberId: 'p1' })

describe('receipt photo in AUTO mode', () => {
  it('stores the payer and operation from the receipt, and warns on a different amount', async () => {
    const { service, bookings } = setup({
      isTransferReceipt: true,
      amount: 10000,
      payerName: 'Juan Perez',
      payerTaxId: '20-30111222-9',
      operationNumber: 'Nro 182842711557',
      destination: 'club.alias',
    })
    const reply = await acknowledge(service)
    expect(bookings.recordReceiptReading).toHaveBeenCalledWith('b1', {
      payerDni: '30111222',
      operationRef: '182842711557',
    })
    expect(reply).toContain('Ya tengo tu comprobante')
    expect(reply).toContain('lo revisa el club')
  })

  it('falls back to the plain acknowledgement when the image is not a readable receipt', async () => {
    const { service, bookings } = setup(null)
    const reply = await acknowledge(service)
    expect(bookings.recordReceiptReading).not.toHaveBeenCalled()
    expect(reply).toContain('Gracias')
  })
})

describe('optional DNI at booking', () => {
  const onBookDni = (service: BotService, msg: string) =>
    (
      service as unknown as { onBookDni: (m: string, c: object, cl: string, w: string) => Promise<{ reply: string }> }
    ).onBookDni(msg, {}, CLUB, WA_ID)

  it('lets the player skip it with "otro" and books without a DNI', async () => {
    const { service } = setup(null)
    const create = jest.fn().mockResolvedValue({ reply: 'ok' })
    ;(service as unknown as { createPendingBooking: jest.Mock }).createPendingBooking = create
    await onBookDni(service, 'otro')
    expect(create).toHaveBeenCalledWith(CLUB, WA_ID, {}, expect.any(Object))
  })

  it('still rejects a malformed DNI', async () => {
    const { service } = setup(null)
    const result = await onBookDni(service, '12')
    expect(result.reply).toBe(BAD_DNI)
  })
})

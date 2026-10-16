import { PaymentsService } from './payments.service'

/**
 * The confirmation message is the product's moment of truth: the player just sent money to
 * an alias and is staring at WhatsApp waiting to be told the court is theirs. Two ways it
 * has broken, both silent:
 *
 *  - the hour was formatted through the *server's* timezone, so a UTC host told the player
 *    22:00 for a 19:00 booking (`toLocale*` without a timeZone — the bug this file pins),
 *  - WhatsApp never delivered it and nobody found out: the money is in, the booking is
 *    CONFIRMED, and the only person who doesn't know is the one who paid.
 */

const booking = {
  playerPhone: '5493411234567',
  clubId: 'club-1',
  depositCents: 5000,
  slot: {
    // A 19:00–22:30 booking in Buenos Aires, stored as the UTC instant it really is.
    startsAt: new Date('2026-07-12T22:00:00Z'),
    endsAt: new Date('2026-07-13T01:30:00Z'),
    court: { name: 'Cancha 1' },
  },
}

function setup(delivered = true) {
  const bookings = { confirmPaymentByAmount: jest.fn().mockResolvedValue('b1') }
  const whatsapp = { sendTextWithRetry: jest.fn().mockResolvedValue(delivered) }
  const notifications = { notifyClub: jest.fn().mockResolvedValue(undefined) }
  const prisma = {
    booking: { findUnique: jest.fn().mockResolvedValue(booking) },
    whatsAppLine: { findFirst: jest.fn().mockResolvedValue({ phoneNumberId: 'line-1' }) },
    club: { findUnique: jest.fn().mockResolvedValue({ name: 'Padel Rosario' }) },
  }
  const service = new PaymentsService(
    bookings as never,
    {} as never,
    {} as never,
    whatsapp as never,
    notifications as never,
    prisma as never,
  )
  return { service, whatsapp, notifications }
}

/** The text the player would receive on their phone. */
const sentBody = (whatsapp: { sendTextWithRetry: jest.Mock }) => whatsapp.sendTextWithRetry.mock.calls[0][2] as string

describe('payment-confirmed message', () => {
  it('tells the player the hour of their club, not the hour of our server', async () => {
    const { service, whatsapp } = setup()

    await service.handleTransferNotification(12550, 'mp-1')

    // The suite runs on a UTC host (see test/jest-global-setup.ts), exactly like production:
    // formatting this booking through the server clock would read "22:00–01:30" on the 13th.
    const body = sentBody(whatsapp)
    expect(body).toContain('19:00–22:30')
    expect(body).toContain('12/07')
    expect(body).toContain('Cancha 1')
    expect(whatsapp.sendTextWithRetry).toHaveBeenCalledWith('line-1', '5493411234567', expect.any(String))
  })

  it('alerts the club and ops when the confirmation never reaches the player', async () => {
    const { service, notifications } = setup(false)

    await service.handleTransferNotification(12550, 'mp-1')

    // The staff can still pick up the phone — but only if they're told. Tapping it opens the
    // booking (who, when, the number to call), not the WhatsApp chat that just failed.
    expect(notifications.notifyClub).toHaveBeenCalledWith(
      'club-1',
      expect.objectContaining({ title: expect.stringContaining('no llegó'), data: { bookingId: 'b1' } }),
    )
  })

  it('stays quiet when the message went through', async () => {
    const { service, notifications } = setup()

    await service.handleTransferNotification(12550, 'mp-1')

    expect(notifications.notifyClub).not.toHaveBeenCalled()
  })

  it('sends nothing when no transfer matched a pending booking', async () => {
    const { service, whatsapp } = setup()
    const bookings = (service as unknown as { bookingsService: { confirmPaymentByAmount: jest.Mock } }).bookingsService
    bookings.confirmPaymentByAmount.mockResolvedValue(null)

    await service.handleTransferNotification(12550, 'mp-1')

    expect(whatsapp.sendTextWithRetry).not.toHaveBeenCalled()
  })
})

describe('other pushes to the staff', () => {
  it('opens the rejected booking when the player never got the "pago rechazado" message', async () => {
    const { service, notifications } = setup(false)
    const bookings = (service as unknown as { bookingsService: Record<string, jest.Mock> }).bookingsService
    bookings.rejectPayment = jest
      .fn()
      .mockResolvedValue({ bookingId: 'b7', playerPhone: '5493411234567', clubId: 'club-1' })

    await service.rejectPaymentManually('club-1', 'b7')

    expect(notifications.notifyClub).toHaveBeenCalledWith(
      'club-1',
      expect.objectContaining({ title: expect.stringContaining('no llegó'), data: { bookingId: 'b7' } }),
    )
  })

  it('opens the Pagos screen when MercadoPago keeps failing for the club', async () => {
    const { service, notifications } = setup()
    const recordFailure = (
      service as unknown as {
        recordClubPollFailure: (clubId: string, reason: string) => Promise<void>
      }
    ).recordClubPollFailure.bind(service)

    // Default threshold: 3 consecutive failures.
    for (let i = 0; i < 3; i++) await recordFailure('club-1', 'token expired')

    expect(notifications.notifyClub).toHaveBeenCalledTimes(1)
    expect(notifications.notifyClub).toHaveBeenCalledWith(
      'club-1',
      expect.objectContaining({ title: expect.stringContaining('MercadoPago'), data: { screen: 'pagos' } }),
    )
  })
})

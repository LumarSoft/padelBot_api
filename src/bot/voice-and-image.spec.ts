import { BotService } from './bot.service'
import { AUDIO_NOT_UNDERSTOOD } from './messages'

/**
 * Voice notes and images. A voice note is transcribed and then handled exactly like the same
 * words typed; an image with no booking waiting for its deposit is read by the model and
 * answered like a message. Neither may leave the player without a reply.
 */

const WA_ID = '5493411234567'
const CLUB = 'club-1'
const AUDIO = { mediaId: 'm1', mimeType: 'audio/ogg; codecs=opus', phoneNumberId: 'p1' }

function setup(opts: { transcript?: string | null; pending?: unknown; description?: string | null } = {}) {
  const media = { download: jest.fn().mockResolvedValue({ bytes: Buffer.from('x'), mimeType: 'audio/ogg' }) }
  const llm = {
    transcribeAudio: jest.fn().mockResolvedValue(opts.transcript ?? null),
    describeImage: jest.fn().mockResolvedValue(opts.description ?? null),
  }
  const sessionService = {
    getOrCreate: jest.fn().mockResolvedValue({ id: 's1', state: 'IDLE', mode: 'AI', humanUntil: null, context: {} }),
    saveMessage: jest.fn().mockResolvedValue(undefined),
  }
  const bookings = { findActivePendingForPlayer: jest.fn().mockResolvedValue(opts.pending ?? null) }
  const service = new BotService(
    { club: { findUnique: jest.fn().mockResolvedValue(null) } } as never, // prisma
    bookings as never,
    {} as never, // availability
    sessionService as never,
    llm as never,
    media as never,
    {} as never, // receiptStorage
    {} as never, // waitlist
    {} as never, // players
    {} as never, // notifications
  )
  const handleMessage = jest.spyOn(service, 'handleMessage').mockResolvedValue({ text: 'respuesta' })
  return { service, llm, handleMessage, sessionService }
}

describe('voice notes', () => {
  it('handles the transcript exactly like typed text', async () => {
    const { service, handleMessage } = setup({ transcript: 'quiero reservar el sábado a las 18' })
    const reply = await service.handleAudio(WA_ID, CLUB, AUDIO)
    expect(handleMessage).toHaveBeenCalledWith(WA_ID, CLUB, 'quiero reservar el sábado a las 18')
    expect(reply).toEqual({ text: 'respuesta' })
  })

  it('asks the player to write when the audio cannot be understood', async () => {
    const { service, handleMessage, sessionService } = setup({ transcript: null })
    const reply = await service.handleAudio(WA_ID, CLUB, AUDIO)
    expect(handleMessage).not.toHaveBeenCalled()
    expect(reply).toEqual({ text: AUDIO_NOT_UNDERSTOOD })
    expect(sessionService.saveMessage).toHaveBeenCalledWith('s1', 'USER', '[Audio]')
  })
})

describe('images outside a payment', () => {
  const IMAGE = { mediaId: 'i1', mimeType: 'image/jpeg', phoneNumberId: 'p1', caption: '¿tienen esto?' }

  it('reads the image and answers it like a message when no deposit is pending', async () => {
    const { service, handleMessage } = setup({ description: 'una paleta de pádel' })
    await service.handleAttachment(WA_ID, CLUB, IMAGE)
    expect(handleMessage).toHaveBeenCalledWith(
      WA_ID,
      CLUB,
      '¿tienen esto?\n(El jugador mandó una imagen: una paleta de pádel)',
    )
  })

  it('keeps treating it as a receipt when a booking awaits its deposit', async () => {
    const { service, llm } = setup({ pending: { id: 'b1' }, description: 'x' })
    await service.handleAttachment(WA_ID, CLUB, IMAGE).catch(() => undefined)
    expect(llm.describeImage).not.toHaveBeenCalled()
  })
})

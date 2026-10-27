import { DeskAction, Prisma } from 'generated/prisma/client'
import { HelpService } from './help.service'
import { PrismaService } from '../prisma/prisma.service'
import { normalizeHelpQuery, isLoggableHelpQuery } from './lib/search-query'

/**
 * The checklist is only worth anything if it ticks from what the user really did, so it is
 * tested at the seams: the rows it reads (bookings, logged desk actions) and the ones it writes.
 */
describe('HelpService', () => {
  function createService(prisma: Record<string, unknown>): HelpService {
    return new HelpService(prisma as unknown as PrismaService)
  }

  describe('getFirstDay', () => {
    function prismaWith(opts: { booked: boolean; actions: DeskAction[]; dismissedAt?: Date | null }) {
      return {
        user: { findUnique: jest.fn().mockResolvedValue({ firstDayDismissedAt: opts.dismissedAt ?? null }) },
        booking: { findFirst: jest.fn().mockResolvedValue(opts.booked ? { id: 'b1' } : null) },
        userFirstAction: { findMany: jest.fn().mockResolvedValue(opts.actions.map(action => ({ action }))) },
      }
    }

    it('starts with nothing done for a brand-new user', async () => {
      const service = createService(prismaWith({ booked: false, actions: [] }))
      const status = await service.getFirstDay(7)
      expect(status.doneCount).toBe(0)
      expect(status.total).toBe(5)
      expect(status.complete).toBe(false)
      expect(status.tasks.map(t => t.id)).toEqual(['booking', 'consumption', 'deskPayment', 'deposit', 'reschedule'])
    })

    it('ticks "anotar un turno" from a booking the user made, and the rest from logged actions', async () => {
      const service = createService(prismaWith({ booked: true, actions: [DeskAction.DESK_PAYMENT] }))
      const status = await service.getFirstDay(7)
      expect(status.tasks.filter(t => t.done).map(t => t.id)).toEqual(['booking', 'deskPayment'])
      expect(status.doneCount).toBe(2)
    })

    it('scopes the booking lookup to bookings made by that user', async () => {
      const prisma = prismaWith({ booked: false, actions: [] })
      await createService(prisma).getFirstDay(7)
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { bookedByUserId: 7 } }))
    })

    it('is complete once all five tasks are done', async () => {
      const service = createService(
        prismaWith({
          booked: true,
          actions: [
            DeskAction.CONSUMPTION,
            DeskAction.DESK_PAYMENT,
            DeskAction.DEPOSIT_CONFIRMATION,
            DeskAction.RESCHEDULE,
          ],
        }),
      )
      const status = await service.getFirstDay(7)
      expect(status.complete).toBe(true)
      expect(status.doneCount).toBe(5)
    })

    it('reports when the user closed the card', async () => {
      const dismissedAt = new Date('2026-10-14T12:00:00Z')
      const service = createService(prismaWith({ booked: false, actions: [], dismissedAt }))
      await expect(service.getFirstDay(7)).resolves.toMatchObject({ dismissedAt })
    })
  })

  describe('news seen', () => {
    it('reads null for a user who never opened the news', async () => {
      const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ newsSeenId: null }) } }
      await expect(createService(prisma).getNewsSeen(7)).resolves.toEqual({ seenId: null })
      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }))
    })

    it('fails for a user that no longer exists', async () => {
      const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } }
      await expect(createService(prisma).getNewsSeen(7)).rejects.toThrow('not found')
    })

    it('stores the newest entry seen on the user, not on the club', async () => {
      const prisma = { user: { update: jest.fn().mockResolvedValue({ id: 7 }) } }
      await expect(createService(prisma).markNewsSeen(7, 'confirmacion-fijos')).resolves.toEqual({
        seenId: 'confirmacion-fijos',
      })
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 7 }, data: { newsSeenId: 'confirmacion-fijos' } }),
      )
    })
  })

  describe('getTeamFirstDay', () => {
    it('aggregates each staff member separately, without one query per user', async () => {
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) },
        booking: { groupBy: jest.fn().mockResolvedValue([{ bookedByUserId: 1 }]) },
        userFirstAction: {
          findMany: jest.fn().mockResolvedValue([
            { userId: 1, action: DeskAction.CONSUMPTION },
            { userId: 2, action: DeskAction.RESCHEDULE },
          ]),
        },
      }
      const team = await createService(prisma).getTeamFirstDay('club-1')

      expect(team).toEqual([
        { userId: 1, done: ['booking', 'consumption'], doneCount: 2, total: 5 },
        { userId: 2, done: ['reschedule'], doneCount: 1, total: 5 },
      ])
      expect(prisma.booking.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clubId: 'club-1', bookedByUserId: { in: [1, 2] } } }),
      )
    })

    it('skips the lookups when the club has no staff', async () => {
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue([]) },
        booking: { groupBy: jest.fn() },
        userFirstAction: { findMany: jest.fn() },
      }
      await expect(createService(prisma).getTeamFirstDay('club-1')).resolves.toEqual([])
      expect(prisma.booking.groupBy).not.toHaveBeenCalled()
    })
  })

  describe('recordFirstAction', () => {
    it('writes once per user and action', async () => {
      const createMany = jest.fn().mockResolvedValue({ count: 1 })
      await createService({ userFirstAction: { createMany } }).recordFirstAction(7, DeskAction.RESCHEDULE)
      expect(createMany).toHaveBeenCalledWith({
        data: [{ userId: 7, action: DeskAction.RESCHEDULE }],
        skipDuplicates: true,
      })
    })

    it('never throws: the real action already succeeded', async () => {
      const createMany = jest.fn().mockRejectedValue(new Error('db down'))
      const service = createService({ userFirstAction: { createMany } })
      await expect(service.recordFirstAction(7, DeskAction.CONSUMPTION)).resolves.toBeUndefined()
    })
  })

  describe('house rules', () => {
    it('trims, drops blank rows and keeps the owner order', async () => {
      const update = jest.fn().mockResolvedValue({})
      const saved = await createService({ club: { update } }).updateHouseRules('club-1', [
        { question: '  ¿Se puede pagar con QR? ', answer: ' Sí, el QR está en el mostrador. ' },
        { question: '   ', answer: 'huérfana' },
        { question: '¿Quién abre los domingos?', answer: 'Lucas, a las 8.' },
      ])
      expect(saved).toEqual([
        { question: '¿Se puede pagar con QR?', answer: 'Sí, el QR está en el mostrador.' },
        { question: '¿Quién abre los domingos?', answer: 'Lucas, a las 8.' },
      ])
      expect(update).toHaveBeenCalledWith({ where: { id: 'club-1' }, data: { houseRules: saved } })
    })

    it('clears the column when every row is blank', async () => {
      const update = jest.fn().mockResolvedValue({})
      await createService({ club: { update } }).updateHouseRules('club-1', [{ question: ' ', answer: ' ' }])
      expect(update).toHaveBeenCalledWith({ where: { id: 'club-1' }, data: { houseRules: Prisma.DbNull } })
    })

    it('tolerates garbage in the stored JSON', async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValue({ houseRules: [{ question: 'ok?', answer: 'sí' }, 'basura', null] })
      await expect(createService({ club: { findUnique } }).getHouseRules('club-1')).resolves.toEqual([
        { question: 'ok?', answer: 'sí' },
      ])
    })
  })

  describe('recordSearchMiss', () => {
    it('counts the normalized query per club', async () => {
      const upsert = jest.fn().mockResolvedValue({ id: 'm1' })
      const result = await createService({ helpSearchMiss: { upsert } }).recordSearchMiss(
        'club-1',
        '  ¿Cómo COBRO   una seña?',
      )
      expect(result).toEqual({ recorded: true })
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clubId_query: { clubId: 'club-1', query: 'como cobro una sena' } },
          update: { count: { increment: 1 } },
        }),
      )
    })

    it('does not store phones, DNIs or two-letter searches', async () => {
      const upsert = jest.fn()
      const service = createService({ helpSearchMiss: { upsert } })
      await expect(service.recordSearchMiss('club-1', '341 555 1234')).resolves.toEqual({ recorded: false })
      await expect(service.recordSearchMiss('club-1', 'dni 30123456')).resolves.toEqual({ recorded: false })
      await expect(service.recordSearchMiss('club-1', 'ok')).resolves.toEqual({ recorded: false })
      expect(upsert).not.toHaveBeenCalled()
    })

    it('retries once when two tabs create the same miss at the same time', async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' })
      const upsert = jest.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ id: 'm1' })
      await createService({ helpSearchMiss: { upsert } }).recordSearchMiss('club-1', 'cerrar caja')
      expect(upsert).toHaveBeenCalledTimes(2)
    })
  })
})

describe('help search normalization', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeHelpQuery('¿Qué hago si NO VINO el fijo?')).toBe('que hago si no vino el fijo')
  })

  it('folds the ñ too, since "sena" is how people type it', () => {
    expect(normalizeHelpQuery('Seña')).toBe('sena')
  })

  it('caps the length', () => {
    expect(normalizeHelpQuery('a'.repeat(200))).toHaveLength(80)
  })

  it('treats spaced-out digits as one run', () => {
    expect(isLoggableHelpQuery('341 555 12')).toBe(false)
    expect(isLoggableHelpQuery('turno de las 21')).toBe(true)
  })
})

import { AuditService } from './audit.service'
import { runWithAuditContext } from './lib/audit-context'

type PrismaStub = { auditLog: { create: jest.Mock } }

function makeService(create: jest.Mock = jest.fn().mockResolvedValue({})) {
  const prisma: PrismaStub = { auditLog: { create } }
  return { service: new AuditService(prisma as never), create }
}

describe('AuditService.diff', () => {
  const { service } = makeService()

  it('detecta el campo modificado y conserva el valor original', () => {
    const changes = service.diff(
      { status: 'PENDING_PAYMENT', depositCents: 4000 },
      { status: 'CONFIRMED', depositCents: 4000 },
    )
    expect(changes).toEqual([{ field: 'status', from: 'PENDING_PAYMENT', to: 'CONFIRMED' }])
  })

  it('trata el alta y la baja de un campo como cambio contra null', () => {
    const changes = service.diff({ notes: null }, { notes: 'llegó tarde' })
    expect(changes).toEqual([{ field: 'notes', from: null, to: 'llegó tarde' }])
  })

  it('compara fechas por su valor y no por identidad de objeto', () => {
    const same = new Date('2026-08-12T18:00:00.000Z')
    expect(service.diff({ at: same }, { at: new Date(same.getTime()) })).toEqual([])
  })

  it('restringe la comparación a los campos declarados', () => {
    const changes = service.diff(
      { status: 'CONFIRMED', updatedAt: new Date('2026-01-01') },
      { status: 'CANCELLED', updatedAt: new Date('2026-02-02') },
      ['status'],
    )
    expect(changes).toEqual([{ field: 'status', from: 'CONFIRMED', to: 'CANCELLED' }])
  })
})

describe('AuditService.sanitize', () => {
  const { service } = makeService()

  it('redacta los campos sensibles y deja pasar el resto', () => {
    expect(service.sanitize({ email: 'a@b.com', password: 'secreto', mpAccessToken: 'APP-1' })).toEqual({
      email: 'a@b.com',
      password: '[REDACTADO]',
      mpAccessToken: '[REDACTADO]',
    })
  })
})

describe('AuditService.record', () => {
  it('toma el actor y el origen del contexto de la petición', async () => {
    const { service, create } = makeService()
    await runWithAuditContext(
      { source: 'PANEL', ip: '1.2.3.4', userId: 7, clubId: 'club_1', actorLabel: 'Lucas (dueño)' },
      () =>
        service.record({
          action: 'STATUS_CHANGE',
          entity: 'Booking',
          entityId: 'bk_1',
          summary: 'Reserva confirmada',
          before: { status: 'PENDING_PAYMENT' },
          after: { status: 'CONFIRMED' },
        }),
    )

    expect(create).toHaveBeenCalledTimes(1)
    const data = create.mock.calls[0][0].data
    expect(data).toMatchObject({
      clubId: 'club_1',
      userId: 7,
      actorLabel: 'Lucas (dueño)',
      actorType: 'USER',
      source: 'PANEL',
      ip: '1.2.3.4',
    })
    expect(data.changes).toEqual([{ field: 'status', from: 'PENDING_PAYMENT', to: 'CONFIRMED' }])
  })

  it('cae en SYSTEM cuando no hay usuario autenticado en el contexto', async () => {
    const { service, create } = makeService()
    await service.record({
      action: 'STATUS_CHANGE',
      entity: 'Booking',
      entityId: 'bk_2',
      summary: 'Confirmada por conciliación',
      clubId: 'club_1',
    })
    expect(create.mock.calls[0][0].data).toMatchObject({ actorType: 'SYSTEM', actorLabel: 'Sistema' })
  })

  it('no propaga el error si la escritura de auditoría falla', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db caída'))
    const { service } = makeService(create)
    await expect(
      service.record({ action: 'CREATE', entity: 'Booking', entityId: 'bk_3', summary: 'Alta' }),
    ).resolves.toBeUndefined()
  })
})

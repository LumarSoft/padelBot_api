import { ForbiddenException } from '@nestjs/common'
import { AuditController } from './audit.controller'
import { AuditQueryService } from './audit-query.service'

/**
 * Consulta de auditoría (RF-12, CA-20). Reading the audit log is the owner's: a staff session
 * is refused before any query runs, and every query is scoped to the club of the session —
 * never to a club taken from the request.
 */

const owner = {
  id: '1',
  email: 'owner@club.test',
  name: 'Dueño',
  clubId: 'club-1',
  clubName: 'Club',
  role: 'owner' as const,
  mustChangePassword: false,
}
const staff = { ...owner, id: '2', role: 'staff' as const }

function setup() {
  const prisma = {
    auditLog: {
      findMany: jest.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]),
      count: jest.fn().mockResolvedValue(2),
    },
  }
  const query = new AuditQueryService(prisma as never)
  const controller = new AuditController(query, { getSummary: jest.fn() } as never)
  return { controller, prisma }
}

describe('AuditController — acceso y alcance de la consulta', () => {
  it('rejects a staff session before querying anything', () => {
    const { controller, prisma } = setup()

    expect(() => controller.findTimeline(staff, 'Booking', 'b1')).toThrow(ForbiddenException)
    expect(() => controller.findAll(staff, {})).toThrow(ForbiddenException)
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
  })

  it("returns the booking timeline of the owner's club, oldest event first", async () => {
    const { controller, prisma } = setup()

    const result = await controller.findTimeline(owner, 'Booking', 'b1')

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { clubId: 'club-1', entity: 'Booking', entityId: 'b1' },
      orderBy: { createdAt: 'asc' },
    })
    expect(result.total).toBe(2)
  })

  it('scopes the activity feed to the session club whatever filters arrive', async () => {
    const { controller, prisma } = setup()

    await controller.findAll(owner, { entity: 'Booking', action: 'STATUS_CHANGE' } as never)

    const args = (prisma.auditLog.findMany.mock.calls[0] as unknown[])[0] as { where: { clubId: string } }
    expect(args.where.clubId).toBe('club-1')
  })
})

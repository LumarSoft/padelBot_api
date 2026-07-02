import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { WhatsAppService } from '../whatsapp/whatsapp.service'
import { BookingEventsService } from '../events/booking-events.service'

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly events: BookingEventsService,
  ) {}

  async listForClub(clubId: string) {
    const sessions = await this.prisma.conversationSession.findMany({
      where: { clubId },
      select: {
        id: true,
        waId: true,
        playerName: true,
        mode: true,
        state: true,
        needsAdvisor: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { role: true, content: true, createdAt: true },
        },
      },
      orderBy: [{ needsAdvisor: 'desc' }, { updatedAt: 'desc' }],
    })

    return sessions.map(s => ({
      id: s.id,
      waId: s.waId,
      playerName: s.playerName ?? null,
      mode: s.mode,
      state: s.state,
      needsAdvisor: s.needsAdvisor,
      updatedAt: s.updatedAt,
      lastMessage: s.messages[0] ?? null,
    }))
  }

  async getMessages(clubId: string, sessionId: string) {
    const session = await this.prisma.conversationSession.findFirst({
      where: { id: sessionId, clubId },
      select: { id: true, waId: true, playerName: true, mode: true, state: true, needsAdvisor: true, createdAt: true },
    })
    if (!session) throw new NotFoundException('Conversación no encontrada')

    const [messages, profile] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, createdAt: true },
      }),
      this.buildPlayerProfile(clubId, session.waId),
    ])

    return { session: { ...session, ...profile }, messages }
  }

  /**
   * Aggregates a player's booking history (matched by their WhatsApp phone) so the panel can
   * show who they are at a glance: total confirmed reservations, how many are still upcoming,
   * the next one, and the DNI the bot last captured.
   */
  private async buildPlayerProfile(clubId: string, waId: string) {
    const now = new Date()
    const [bookingsConfirmed, bookingsUpcoming, nextBooking, lastWithDni] = await Promise.all([
      this.prisma.booking.count({ where: { clubId, playerPhone: waId, status: 'CONFIRMED' } }),
      this.prisma.booking.count({
        where: { clubId, playerPhone: waId, status: 'CONFIRMED', slot: { startsAt: { gte: now } } },
      }),
      this.prisma.booking.findFirst({
        where: { clubId, playerPhone: waId, status: 'CONFIRMED', slot: { startsAt: { gte: now } } },
        orderBy: { slot: { startsAt: 'asc' } },
        select: { slot: { select: { startsAt: true, court: { select: { name: true } } } } },
      }),
      this.prisma.booking.findFirst({
        where: { clubId, playerPhone: waId, playerDni: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { playerDni: true },
      }),
    ])

    return {
      bookingsConfirmed,
      bookingsUpcoming,
      nextBooking: nextBooking
        ? { startsAt: nextBooking.slot.startsAt, courtName: nextBooking.slot.court.name }
        : null,
      playerDni: lastWithDni?.playerDni ?? null,
    }
  }

  async setMode(clubId: string, sessionId: string, mode: 'AI' | 'HUMAN') {
    const session = await this.prisma.conversationSession.findFirst({
      where: { id: sessionId, clubId },
      select: { id: true },
    })
    if (!session) throw new NotFoundException('Conversación no encontrada')

    await this.prisma.conversationSession.update({
      where: { id: sessionId },
      // Acting on the conversation clears the "waiting for advisor" flag.
      data: { mode, needsAdvisor: false },
    })

    return { mode }
  }

  async sendMessage(clubId: string, sessionId: string, content: string) {
    const session = await this.prisma.conversationSession.findFirst({
      where: { id: sessionId, clubId },
      select: {
        id: true,
        waId: true,
        playerName: true,
        club: {
          select: { whatsappLines: { where: { isActive: true }, take: 1, select: { phoneNumberId: true } } },
        },
      },
    })
    if (!session) throw new NotFoundException('Conversación no encontrada')

    const message = await this.prisma.conversationMessage.create({
      data: { sessionId, role: 'ADMIN', content },
      select: { id: true, role: true, content: true, createdAt: true },
    })

    // Update updatedAt so the conversation bubbles to the top of the list; replying
    // also clears the "waiting for advisor" flag.
    await this.prisma.conversationSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date(), needsAdvisor: false },
    })

    // Fire SSE event so other connected admins see the new message
    this.events.emitConversation({
      type: 'conversation.message',
      clubId,
      sessionId,
      waId: session.waId,
      playerName: session.playerName,
    })

    // Send via WhatsApp
    const phoneNumberId = session.club.whatsappLines[0]?.phoneNumberId
    if (phoneNumberId) {
      await this.whatsapp.sendText(phoneNumberId, session.waId, content)
    }

    return message
  }
}

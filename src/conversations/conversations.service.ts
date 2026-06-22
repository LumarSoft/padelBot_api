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
        updatedAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { role: true, content: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return sessions.map(s => ({
      id: s.id,
      waId: s.waId,
      playerName: s.playerName ?? null,
      mode: s.mode,
      state: s.state,
      updatedAt: s.updatedAt,
      lastMessage: s.messages[0] ?? null,
    }))
  }

  async getMessages(clubId: string, sessionId: string) {
    const session = await this.prisma.conversationSession.findFirst({
      where: { id: sessionId, clubId },
      select: { id: true, waId: true, playerName: true, mode: true, state: true },
    })
    if (!session) throw new NotFoundException('Conversación no encontrada')

    const messages = await this.prisma.conversationMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    })

    return { session, messages }
  }

  async setMode(clubId: string, sessionId: string, mode: 'AI' | 'HUMAN') {
    const session = await this.prisma.conversationSession.findFirst({
      where: { id: sessionId, clubId },
      select: { id: true },
    })
    if (!session) throw new NotFoundException('Conversación no encontrada')

    await this.prisma.conversationSession.update({
      where: { id: sessionId },
      data: { mode },
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

    // Update updatedAt so the conversation bubbles to the top of the list
    await this.prisma.conversationSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
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

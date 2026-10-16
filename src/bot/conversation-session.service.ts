import { Injectable } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { BookingEventsService } from '../events/booking-events.service'
import { BotState, SessionContext } from './types'

const SESSION_TTL_MINUTES = 30

export interface SessionSnapshot {
  id: string
  state: string
  mode: string
  humanUntil: Date | null
  context: SessionContext
}

@Injectable()
export class ConversationSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: BookingEventsService,
  ) {}

  async getOrCreate(waId: string, clubId: string): Promise<SessionSnapshot> {
    const now = new Date()

    const existing = await this.prisma.conversationSession.findUnique({
      where: { waId_clubId: { waId, clubId } },
      select: { id: true, state: true, mode: true, humanUntil: true, context: true, expiresAt: true },
    })

    if (existing) {
      const ctx = safeParseContext(existing.context)
      if (existing.expiresAt < now) {
        const reset = await this.prisma.conversationSession.update({
          where: { id: existing.id },
          data: { state: BotState.IDLE, context: keepName(ctx) as Prisma.InputJsonValue, expiresAt: newExpiry() },
          select: { id: true, state: true, mode: true, humanUntil: true, context: true },
        })
        return { ...reset, context: safeParseContext(reset.context) }
      }
      return {
        id: existing.id,
        state: existing.state,
        mode: existing.mode,
        humanUntil: existing.humanUntil,
        context: ctx,
      }
    }

    const created = await this.prisma.conversationSession.create({
      data: { waId, clubId, state: BotState.IDLE, context: {}, expiresAt: newExpiry() },
      select: { id: true, state: true, mode: true, humanUntil: true, context: true },
    })
    return { ...created, context: safeParseContext(created.context) }
  }

  /**
   * The id of the player's chat at this club — what `GET /conversations/:id/messages` takes —
   * without touching it (unlike {@link getOrCreate}, which resets an expired one). Null if the
   * player never wrote.
   */
  async findId(waId: string, clubId: string): Promise<string | null> {
    const session = await this.prisma.conversationSession.findUnique({
      where: { waId_clubId: { waId, clubId } },
      select: { id: true },
    })
    return session?.id ?? null
  }

  async update(id: string, state: BotState, ctx: SessionContext): Promise<void> {
    await this.prisma.conversationSession.update({
      where: { id },
      data: {
        state,
        context: ctx as Prisma.InputJsonValue,
        expiresAt: newExpiry(),
        ...(ctx.playerName ? { playerName: ctx.playerName } : {}),
      },
    })
  }

  /**
   * Switches who answers the chat. `humanUntil` makes a HUMAN takeover temporary (the bot
   * takes the chat back after it); null = indefinite, or clears it when going back to AI.
   */
  async setMode(sessionId: string, mode: 'AI' | 'HUMAN', humanUntil: Date | null = null): Promise<void> {
    await this.prisma.conversationSession.update({
      where: { id: sessionId },
      data: { mode, humanUntil },
    })
  }

  /**
   * Hands a chat to the club and flags it in the panel ("Pide asesor"): the bot goes quiet until
   * someone switches it back from Conversaciones.
   */
  async requestAdvisor(sessionId: string): Promise<void> {
    await this.prisma.conversationSession.update({
      where: { id: sessionId },
      data: { mode: 'HUMAN', humanUntil: null, needsAdvisor: true },
    })
  }

  /**
   * Wipes the chat for the `/reset` command: deletes every stored message and returns the
   * session to a clean IDLE state (no name/context). Emits a conversation event so the panel
   * thread refreshes to empty.
   */
  async reset(sessionId: string): Promise<void> {
    const session = await this.prisma.conversationSession.findUnique({
      where: { id: sessionId },
      select: { clubId: true, waId: true },
    })

    await this.prisma.conversationMessage.deleteMany({ where: { sessionId } })
    await this.prisma.conversationSession.update({
      where: { id: sessionId },
      data: { state: BotState.IDLE, context: {}, playerName: null, expiresAt: newExpiry() },
    })

    if (session) {
      this.events.emitConversation({
        type: 'conversation.message',
        clubId: session.clubId,
        sessionId,
        waId: session.waId,
        playerName: null,
      })
    }
  }

  async saveMessage(sessionId: string, role: 'USER' | 'BOT' | 'ADMIN', content: string): Promise<void> {
    await this.prisma.conversationMessage.create({
      data: { sessionId, role, content },
    })

    // Fetch session to emit SSE event
    const session = await this.prisma.conversationSession.findUnique({
      where: { id: sessionId },
      select: { clubId: true, waId: true, playerName: true },
    })
    if (session) {
      this.events.emitConversation({
        type: 'conversation.message',
        clubId: session.clubId,
        sessionId,
        waId: session.waId,
        playerName: session.playerName,
      })
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function newExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000)
}

function safeParseContext(raw: Prisma.JsonValue): SessionContext {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as unknown as SessionContext
  }
  return {}
}

export function keepName(ctx: SessionContext): SessionContext {
  const kept: SessionContext = {}
  if (ctx.playerName) kept.playerName = ctx.playerName
  if (ctx.playerDni) kept.playerDni = ctx.playerDni
  return kept
}

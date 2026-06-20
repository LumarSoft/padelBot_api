import { Injectable } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { BotState, SessionContext } from './types'

const SESSION_TTL_MINUTES = 30

@Injectable()
export class ConversationSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the active session for this user+club, or creates one from scratch.
   * Expired sessions are reset to IDLE but their playerName is preserved so the
   * user doesn't have to re-enter it on the next interaction.
   */
  async getOrCreate(waId: string, clubId: string): Promise<{ id: string; state: string; context: SessionContext }> {
    const now = new Date()

    const existing = await this.prisma.conversationSession.findUnique({
      where: { waId_clubId: { waId, clubId } },
      select: { id: true, state: true, context: true, expiresAt: true },
    })

    if (existing) {
      const ctx = safeParseContext(existing.context)
      if (existing.expiresAt < now) {
        const reset = await this.prisma.conversationSession.update({
          where: { id: existing.id },
          data: { state: BotState.IDLE, context: keepName(ctx) as Prisma.InputJsonValue, expiresAt: newExpiry() },
          select: { id: true, state: true, context: true },
        })
        return { id: reset.id, state: reset.state, context: safeParseContext(reset.context) }
      }
      return { id: existing.id, state: existing.state, context: ctx }
    }

    const created = await this.prisma.conversationSession.create({
      data: { waId, clubId, state: BotState.IDLE, context: {}, expiresAt: newExpiry() },
      select: { id: true, state: true, context: true },
    })
    return { id: created.id, state: created.state, context: safeParseContext(created.context) }
  }

  async update(id: string, state: BotState, ctx: SessionContext): Promise<void> {
    await this.prisma.conversationSession.update({
      where: { id },
      data: { state, context: ctx as Prisma.InputJsonValue, expiresAt: newExpiry() },
    })
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
  return ctx.playerName ? { playerName: ctx.playerName } : {}
}

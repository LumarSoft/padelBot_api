import { Injectable, Logger } from '@nestjs/common'
import { Expo, ExpoPushMessage } from 'expo-server-sdk'
import { PrismaService } from '../prisma/prisma.service'
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto'
import { UnregisterDeviceTokenDto } from './dto/unregister-device-token.dto'

export interface PushPayload {
  title: string
  body: string
  /** Deep-link target the app navigates to on tap, e.g. `{ bookingId }`. */
  data?: Record<string, unknown>
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)
  private readonly expo = new Expo()

  constructor(private readonly prisma: PrismaService) {}

  async registerToken(userId: number, clubId: string, dto: RegisterDeviceTokenDto): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      update: { userId, clubId, platform: dto.platform },
      create: { userId, clubId, token: dto.token, platform: dto.platform },
    })
  }

  async unregisterToken(userId: number, dto: UnregisterDeviceTokenDto): Promise<void> {
    // Scoped to the caller so one user can't remove another's device token.
    await this.prisma.deviceToken.deleteMany({ where: { token: dto.token, userId } })
  }

  /**
   * Fans a push out to every device registered for the club. Best-effort: a failure here must
   * never break the booking/payment action that triggered it. Tokens Expo reports as
   * `DeviceNotRegistered` (uninstalled app, revoked permission) are pruned immediately.
   */
  async notifyClub(clubId: string, payload: PushPayload): Promise<void> {
    try {
      const devices = await this.prisma.deviceToken.findMany({
        where: { clubId },
        select: { token: true },
      })
      if (devices.length === 0) return

      const messages: ExpoPushMessage[] = devices
        .filter(d => Expo.isExpoPushToken(d.token))
        .map(d => ({
          to: d.token,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          sound: 'default',
        }))
      if (messages.length === 0) return

      const staleTokens: string[] = []
      for (const chunk of this.expo.chunkPushNotifications(messages)) {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk)
        tickets.forEach((ticket, i) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            staleTokens.push(chunk[i].to as string)
          }
        })
      }

      if (staleTokens.length > 0) {
        await this.prisma.deviceToken.deleteMany({ where: { token: { in: staleTokens } } })
      }
    } catch (err) {
      this.logger.error(`Failed to send push notification for club ${clubId}`, err)
    }
  }
}

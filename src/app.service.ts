import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma/prisma.service'

export interface HealthStatus {
  status: 'ok' | 'degraded'
  db: 'up' | 'down'
  timestamp: string
}

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!'
  }

  /** Liveness + DB connectivity check for uptime monitoring. */
  async getHealth(): Promise<HealthStatus> {
    let db: HealthStatus['db'] = 'up'
    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch {
      db = 'down'
    }
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      timestamp: new Date().toISOString(),
    }
  }
}

import { Controller, Get, HttpStatus, Res } from '@nestjs/common'
import type { Response } from 'express'
import { AppService, HealthStatus } from './app.service'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello()
  }

  /** Public readiness check for uptime monitors / load balancers. */
  @Get('health')
  async getHealth(@Res({ passthrough: true }) response: Response): Promise<HealthStatus> {
    const health = await this.appService.getHealth()
    response.status(health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
    return health
  }
}

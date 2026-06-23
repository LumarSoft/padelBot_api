import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common'
import { AppService, HealthStatus } from './app.service'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello()
  }

  /** Public health check for uptime monitors / load balancers. Always returns 200; the
   * body reports whether the DB is reachable so a monitor can alert on `db: "down"`. */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  getHealth(): Promise<HealthStatus> {
    return this.appService.getHealth()
  }
}

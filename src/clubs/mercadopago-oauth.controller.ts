import { Controller, Get, Logger, Query, Res } from '@nestjs/common'
import { Response } from 'express'
import { ClubsService } from './clubs.service'

/**
 * Public OAuth callback for MercadoPago Connect. MercadoPago redirects the owner's
 * browser here after they authorize, so it cannot be JWT-guarded — the request carries
 * no app session. Security comes from the signed, time-limited `state` (verified in
 * ClubsService), which binds the callback to the club that started the flow.
 */
@Controller('clubs/mercadopago')
export class MercadoPagoOAuthController {
  private readonly logger = new Logger(MercadoPagoOAuthController.name)

  constructor(private readonly clubsService: ClubsService) {}

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response): Promise<void> {
    const panel = process.env.ADMIN_ORIGIN ?? 'http://localhost:3000'
    try {
      if (!code || !state) throw new Error('Missing code/state')
      await this.clubsService.handleConnectCallback(code, state)
      res.redirect(`${panel}/configuracion?mp=connected`)
    } catch (err) {
      this.logger.error('MercadoPago OAuth callback failed', err)
      res.redirect(`${panel}/configuracion?mp=error`)
    }
  }
}

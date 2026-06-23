import { Module } from '@nestjs/common'
import { MercadoPagoModule } from '../mercadopago/mercadopago.module'
import { ClubsController } from './clubs.controller'
import { MercadoPagoOAuthController } from './mercadopago-oauth.controller'
import { ClubsService } from './clubs.service'

@Module({
  imports: [MercadoPagoModule],
  controllers: [ClubsController, MercadoPagoOAuthController],
  providers: [ClubsService],
  exports: [ClubsService],
})
export class ClubsModule {}

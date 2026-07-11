import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { ClubsService } from './clubs.service'
import { ConnectMercadoPagoDto } from './dto/connect-mercadopago.dto'
import { UpdateTransferConfigDto } from './dto/update-transfer-config.dto'
import { UpdateClubProfileDto } from './dto/update-club-profile.dto'

@Controller('clubs')
@UseGuards(JwtAuthGuard)
export class ClubsController {
  constructor(private readonly clubsService: ClubsService) {}

  @Get('me/profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.clubsService.getProfile(user.clubId)
  }

  /** Subscription state for the panel banner (trial days left / past-due warning). */
  @Get('me/subscription')
  getSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.clubsService.getSubscriptionState(user.clubId)
  }

  @Patch('me/profile')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateClubProfileDto) {
    this.assertOwner(user)
    return this.clubsService.updateProfile(user.clubId, dto)
  }

  @Get('me/transfer-config')
  getTransferConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.clubsService.getTransferConfig(user.clubId)
  }

  @Patch('me/transfer-config')
  updateTransferConfig(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTransferConfigDto) {
    this.assertOwner(user)
    return this.clubsService.updateTransferConfig(user.clubId, dto)
  }

  // ── MercadoPago Connect (OAuth) ──────────────────────────────────────────────

  @Get('me/mercadopago')
  getMercadoPagoStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.clubsService.getMercadoPagoStatus(user.clubId)
  }

  /**
   * Returns the URL the owner's browser must visit to authorize their MP account. `origin`
   * says which screen they started from so the OAuth callback returns them there (the setup
   * wizard must not lose them to Configuración mid-flow).
   */
  @Post('me/mercadopago/connect')
  @HttpCode(HttpStatus.OK)
  connectMercadoPago(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConnectMercadoPagoDto,
  ): { url: string } {
    this.assertOwner(user)
    return { url: this.clubsService.buildConnectUrl(user.clubId, dto.origin) }
  }

  @Delete('me/mercadopago')
  @HttpCode(HttpStatus.OK)
  async disconnectMercadoPago(@CurrentUser() user: AuthenticatedUser): Promise<{ disconnected: true }> {
    this.assertOwner(user)
    await this.clubsService.disconnectMercadoPago(user.clubId)
    return { disconnected: true }
  }

  private assertOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Only the club owner can change payment settings')
    }
  }
}

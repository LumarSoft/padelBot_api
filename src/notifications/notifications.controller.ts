import { Body, Controller, Delete, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { NotificationsService } from './notifications.service'
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto'
import { UnregisterDeviceTokenDto } from './dto/unregister-device-token.dto'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceTokenDto) {
    return this.notifications.registerToken(parseInt(user.id, 10), user.clubId, dto)
  }

  @Delete('register')
  @HttpCode(HttpStatus.OK)
  unregister(@CurrentUser() user: AuthenticatedUser, @Body() dto: UnregisterDeviceTokenDto) {
    return this.notifications.unregisterToken(parseInt(user.id, 10), dto)
  }
}

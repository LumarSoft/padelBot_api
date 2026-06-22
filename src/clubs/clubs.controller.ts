import { Body, Controller, ForbiddenException, Get, Patch, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { ClubsService } from './clubs.service'
import { UpdateTransferConfigDto } from './dto/update-transfer-config.dto'

@Controller('clubs')
@UseGuards(JwtAuthGuard)
export class ClubsController {
  constructor(private readonly clubsService: ClubsService) {}

  @Get('me/transfer-config')
  getTransferConfig(@CurrentUser() user: AuthenticatedUser) {
    return this.clubsService.getTransferConfig(user.clubId)
  }

  @Patch('me/transfer-config')
  updateTransferConfig(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTransferConfigDto) {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Only the club owner can change payment settings')
    }
    return this.clubsService.updateTransferConfig(user.clubId, dto)
  }
}

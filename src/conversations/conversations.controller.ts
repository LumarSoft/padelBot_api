import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { ConversationsService } from './conversations.service'
import { SetModeDto } from './dto/set-mode.dto'
import { SendMessageDto } from './dto/send-message.dto'

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.conversationsService.listForClub(user.clubId)
  }

  @Get(':id/messages')
  getMessages(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.conversationsService.getMessages(user.clubId, id)
  }

  @Patch(':id/mode')
  setMode(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SetModeDto) {
    return this.conversationsService.setMode(user.clubId, id, dto.mode)
  }

  @Post(':id/messages')
  sendMessage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.conversationsService.sendMessage(user.clubId, id, dto.content)
  }
}

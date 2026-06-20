import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { WhatsAppLinesService } from './whatsapp-lines.service'
import { CreateWhatsAppLineDto } from './dto/create-whatsapp-line.dto'

@Controller('whatsapp-lines')
@UseGuards(JwtAuthGuard)
export class WhatsAppLinesController {
  constructor(private readonly whatsAppLinesService: WhatsAppLinesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.whatsAppLinesService.findAll(user.clubId)
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWhatsAppLineDto) {
    return this.whatsAppLinesService.create(user.clubId, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.whatsAppLinesService.remove(user.clubId, id)
  }
}

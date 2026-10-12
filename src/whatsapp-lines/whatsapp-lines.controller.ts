import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { WhatsAppLinesService } from './whatsapp-lines.service'
import { CreateWhatsAppLineDto } from './dto/create-whatsapp-line.dto'
import { EmbeddedSignupDto } from './dto/embedded-signup.dto'

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

  /** Public ids the panel needs to open Meta's Embedded Signup popup (null when not set up). */
  @Get('embedded-signup/config')
  embeddedSignupConfig() {
    return this.whatsAppLinesService.embeddedSignupConfig()
  }

  /** Finishes Meta's Embedded Signup popup (owner only): connects the number to this club. */
  @Post('embedded-signup')
  embeddedSignup(@CurrentUser() user: AuthenticatedUser, @Body() dto: EmbeddedSignupDto) {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño del club puede conectar WhatsApp')
    }
    return this.whatsAppLinesService.connectEmbeddedSignup(user.clubId, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.whatsAppLinesService.remove(user.clubId, id)
  }
}

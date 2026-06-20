import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { CourtsService } from './courts.service'
import { CreateCourtDto } from './dto/create-court.dto'
import { UpdateCourtDto } from './dto/update-court.dto'

@Controller('courts')
@UseGuards(JwtAuthGuard)
export class CourtsController {
  constructor(private readonly courtsService: CourtsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.courtsService.findAll(user.clubId)
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.courtsService.findOne(user.clubId, id)
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCourtDto) {
    return this.courtsService.create(user.clubId, dto)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCourtDto) {
    return this.courtsService.update(user.clubId, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.courtsService.remove(user.clubId, id)
  }
}

import {
  ForbiddenException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { CourtsService } from './courts.service'
import { CreateCourtDto } from './dto/create-court.dto'
import { BulkPriceAdjustDto } from './dto/bulk-price-adjust.dto'
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

  /** Mass price adjustment ("subí todo 10%") across courts + price rules. Owner-only.
   *  With a future `effectiveDate` it SCHEDULES the change instead of applying it. */
  @Post('bulk-price')
  bulkPrice(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkPriceAdjustDto) {
    this.assertOwner(user)
    return this.courtsService.bulkAdjustPrices(user.clubId, dto)
  }

  /** Pending scheduled price adjustments. Owner-only. */
  @Get('scheduled-price-adjustments')
  listScheduled(@CurrentUser() user: AuthenticatedUser) {
    this.assertOwner(user)
    return this.courtsService.listScheduledAdjustments(user.clubId)
  }

  @Delete('scheduled-price-adjustments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeScheduled(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOwner(user)
    return this.courtsService.removeScheduledAdjustment(user.clubId, id)
  }

  private assertOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño puede ajustar precios masivamente')
    }
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

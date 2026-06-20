import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { SlotsService } from './slots.service'
import { CreateSlotDto } from './dto/create-slot.dto'
import { UpdateSlotDto } from './dto/update-slot.dto'
import { QuerySlotsDto } from './dto/query-slots.dto'
import { BulkBlockSlotsDto } from './dto/bulk-block-slots.dto'

@Controller('slots')
@UseGuards(JwtAuthGuard)
export class SlotsController {
  constructor(private readonly slotsService: SlotsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QuerySlotsDto) {
    return this.slotsService.findAll(user.clubId, query)
  }

  @Post('bulk-block')
  @HttpCode(HttpStatus.OK)
  bulkBlock(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkBlockSlotsDto) {
    return this.slotsService.bulkBlock(user.clubId, dto)
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.slotsService.findOne(user.clubId, id)
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSlotDto) {
    return this.slotsService.create(user.clubId, dto)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSlotDto) {
    return this.slotsService.update(user.clubId, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.slotsService.remove(user.clubId, id)
  }
}

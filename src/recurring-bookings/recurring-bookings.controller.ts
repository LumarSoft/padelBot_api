import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { RecurringBookingsService } from './recurring-bookings.service'
import { CreateRecurringBookingDto } from './dto/create-recurring-booking.dto'
import { UpdateRecurringBookingDto } from './dto/update-recurring-booking.dto'

@Controller('recurring-bookings')
@UseGuards(JwtAuthGuard)
export class RecurringBookingsController {
  constructor(private readonly recurringBookingsService: RecurringBookingsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.recurringBookingsService.findAll(user.clubId)
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.recurringBookingsService.findOne(user.clubId, id)
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRecurringBookingDto) {
    return this.recurringBookingsService.create(user.clubId, parseInt(user.id, 10), dto)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateRecurringBookingDto) {
    return this.recurringBookingsService.update(user.clubId, id, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.recurringBookingsService.remove(user.clubId, id)
  }

  @Post(':id/apply')
  applyToExistingSlots(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.recurringBookingsService.applyToExistingSlots(user.clubId, id)
  }
}

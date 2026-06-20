import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { BookingsService } from './bookings.service'
import { CreateBookingDto } from './dto/create-booking.dto'
import { RescheduleBookingDto } from './dto/reschedule-booking.dto'
import { QueryBookingsDto } from './dto/query-bookings.dto'

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryBookingsDto) {
    return this.bookingsService.findAll(user.clubId, query)
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookingsService.findOne(user.clubId, id)
  }

  @Post()
  book(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBookingDto) {
    return this.bookingsService.book(user.clubId, dto, parseInt(user.id, 10))
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookingsService.cancel(user.clubId, id)
  }

  @Patch(':id/reschedule')
  reschedule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RescheduleBookingDto) {
    return this.bookingsService.reschedule(user.clubId, id, dto)
  }
}

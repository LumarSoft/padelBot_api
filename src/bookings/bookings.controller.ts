import {
  Controller,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common'
import { Response } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { BookingsService } from './bookings.service'
import { ReceiptStorageService } from '../storage/receipt-storage.service'
import { CreateBookingDto } from './dto/create-booking.dto'
import { RescheduleBookingDto } from './dto/reschedule-booking.dto'
import { QueryBookingsDto } from './dto/query-bookings.dto'
import { SetBookingProductsDto } from './dto/set-booking-products.dto'

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly receiptStorage: ReceiptStorageService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryBookingsDto) {
    return this.bookingsService.findAll(user.clubId, query)
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookingsService.findOne(user.clubId, id)
  }

  /**
   * Streams the latest transfer-receipt image for a booking (RECEIPT mode). Club-scoped and
   * auth-guarded; the raw object-storage URL never leaves the server. The browser reaches this
   * through the panel's same-origin BFF proxy.
   */
  @Get(':id/receipt')
  async receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const receipt = await this.bookingsService.getLatestReceipt(user.clubId, id)
    const bytes = await this.receiptStorage.getBytes(receipt)
    res.setHeader('Content-Type', receipt.mimeType)
    res.setHeader('Cache-Control', 'private, max-age=60')
    return new StreamableFile(bytes)
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

  @Put(':id/products')
  setProducts(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SetBookingProductsDto) {
    return this.bookingsService.setBookingProducts(user.clubId, id, dto)
  }
}

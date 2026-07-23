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
  Delete,
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
import { LocalPaymentDto } from './dto/local-payment.dto'
import { AddPlayerPaymentDto } from './dto/add-player-payment.dto'
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

  /** Soft-deletes a CANCELLED reservation so it drops out of the club's lists (staff or owner). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookingsService.remove(user.clubId, id)
  }

  /** The turno's bill: per-player owed/paid/remaining, seña credited to J1, settled state. */
  @Get(':id/account')
  getAccount(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookingsService.getAccount(user.clubId, id)
  }

  /** Registers one player's payment toward the bill; settles the turno when it's covered. */
  @Post(':id/payments')
  @HttpCode(HttpStatus.OK)
  addPlayerPayment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddPlayerPaymentDto) {
    return this.bookingsService.addPlayerPayment(user.clubId, id, dto)
  }

  /** Undoes a registered player payment. */
  @Delete(':id/payments/:paymentId')
  @HttpCode(HttpStatus.OK)
  removePlayerPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.bookingsService.removePlayerPayment(user.clubId, id, paymentId)
  }

  /** Records a front-desk collection (cash / club QR) so the daily cash closure adds up. */
  @Patch(':id/local-payment')
  @HttpCode(HttpStatus.OK)
  setLocalPayment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: LocalPaymentDto) {
    return this.bookingsService.setLocalPayment(user.clubId, id, dto)
  }

  /** Marks a confirmed booking as a no-show (player never came) — feeds the CRM counter. */
  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  markNoShow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookingsService.markNoShow(user.clubId, id)
  }

  @Delete(':id/no-show')
  @HttpCode(HttpStatus.NO_CONTENT)
  unmarkNoShow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookingsService.unmarkNoShow(user.clubId, id)
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

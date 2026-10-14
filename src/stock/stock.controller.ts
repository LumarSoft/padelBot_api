import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { StockService } from './stock.service'
import { RegisterPurchaseDto } from './dto/register-purchase.dto'
import { RegisterCountDto } from './dto/register-count.dto'
import { CreateCounterSaleDto } from './dto/create-counter-sale.dto'
import { QueryMovementsDto } from './dto/query-movements.dto'
import { QueryCounterSalesDto } from './dto/query-counter-sales.dto'

/** Numeric id of the caller for the ledger's "who did it". */
const userIdOf = (user: AuthenticatedUser): number | null => {
  const id = parseInt(user.id, 10)
  return Number.isNaN(id) ? null : id
}

/**
 * Kiosk stock. Open to OWNER and STAFF on purpose: the front desk is who receives the
 * delivery, counts the shelf and sells the loose drink. Prices and the catalog itself stay in
 * `products`.
 */
@Controller('stock')
@UseGuards(JwtAuthGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('purchases')
  registerPurchase(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterPurchaseDto) {
    return this.stockService.registerPurchase(user.clubId, userIdOf(user), dto)
  }

  @Post('counts')
  registerCount(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterCountDto) {
    return this.stockService.registerCount(user.clubId, userIdOf(user), dto)
  }

  @Get('shopping-list')
  shoppingList(@CurrentUser() user: AuthenticatedUser) {
    return this.stockService.shoppingList(user.clubId)
  }

  @Get('products/:productId/movements')
  movements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
    @Query() query: QueryMovementsDto,
  ) {
    return this.stockService.movements(user.clubId, productId, query.limit)
  }

  @Post('counter-sales')
  createCounterSale(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCounterSaleDto) {
    return this.stockService.createCounterSale(user.clubId, userIdOf(user), dto)
  }

  @Get('counter-sales')
  listCounterSales(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryCounterSalesDto) {
    return this.stockService.listCounterSales(user.clubId, query.date)
  }

  @Delete('counter-sales/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCounterSale(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.stockService.removeCounterSale(user.clubId, id, userIdOf(user))
  }
}

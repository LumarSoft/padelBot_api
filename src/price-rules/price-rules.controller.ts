import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { PriceRulesService } from './price-rules.service'
import { CreatePriceRuleDto } from './dto/create-price-rule.dto'
import { UpdatePriceRuleDto } from './dto/update-price-rule.dto'

@Controller()
@UseGuards(JwtAuthGuard)
export class PriceRulesController {
  constructor(private readonly priceRulesService: PriceRulesService) {}

  @Get('courts/:courtId/price-rules')
  findAll(@CurrentUser() user: AuthenticatedUser, @Param('courtId') courtId: string) {
    return this.priceRulesService.findAllForCourt(user.clubId, courtId)
  }

  @Post('courts/:courtId/price-rules')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courtId') courtId: string,
    @Body() dto: CreatePriceRuleDto,
  ) {
    return this.priceRulesService.create(user.clubId, courtId, dto)
  }

  @Patch('price-rules/:id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePriceRuleDto) {
    return this.priceRulesService.update(user.clubId, id, dto)
  }

  @Delete('price-rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.priceRulesService.remove(user.clubId, id)
  }
}

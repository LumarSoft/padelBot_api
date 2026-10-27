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
import { CompetitionsService } from './competitions.service'
import { CreateCompetitionDto } from './dto/create-competition.dto'
import { UpdateCompetitionDto } from './dto/update-competition.dto'
import { QueryCompetitionsDto } from './dto/query-competitions.dto'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { CreatePairDto } from './dto/create-pair.dto'
import { UpdatePairDto } from './dto/update-pair.dto'
import { UpdatePlayerPaymentDto } from './dto/update-player-payment.dto'
import { UpdateMatchDto } from './dto/update-match.dto'

/** Torneos and peñas. Open to staff: the desk runs them. */
@Controller('competitions')
@UseGuards(JwtAuthGuard)
export class CompetitionsController {
  constructor(private readonly competitionsService: CompetitionsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryCompetitionsDto) {
    return this.competitionsService.findAll(user.clubId, query)
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.competitionsService.findOne(user.clubId, id)
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompetitionDto) {
    return this.competitionsService.create(user.clubId, parseInt(user.id, 10), dto)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCompetitionDto) {
    return this.competitionsService.update(user.clubId, id, dto)
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.competitionsService.cancel(user.clubId, id)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.competitionsService.remove(user.clubId, id)
  }

  @Post(':id/categories')
  addCategory(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateCategoryDto) {
    return this.competitionsService.addCategory(user.clubId, id, dto)
  }

  @Patch(':id/categories/:categoryId')
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.competitionsService.updateCategory(user.clubId, id, categoryId, dto)
  }

  @Delete(':id/categories/:categoryId')
  removeCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.competitionsService.removeCategory(user.clubId, id, categoryId)
  }

  @Post(':id/categories/:categoryId/fixture')
  generateFixture(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.competitionsService.generateFixture(user.clubId, id, categoryId)
  }

  @Delete(':id/categories/:categoryId/fixture')
  deleteFixture(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.competitionsService.deleteFixture(user.clubId, id, categoryId)
  }

  @Post(':id/categories/:categoryId/bracket')
  generateBracket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.competitionsService.generateBracket(user.clubId, id, categoryId)
  }

  @Delete(':id/categories/:categoryId/bracket')
  deleteBracket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.competitionsService.deleteBracket(user.clubId, id, categoryId)
  }

  @Post(':id/pairs')
  addPair(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreatePairDto) {
    return this.competitionsService.addPair(user.clubId, id, dto)
  }

  @Patch(':id/pairs/:pairId')
  updatePair(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('pairId') pairId: string,
    @Body() dto: UpdatePairDto,
  ) {
    return this.competitionsService.updatePair(user.clubId, id, pairId, dto)
  }

  @Delete(':id/pairs/:pairId')
  removePair(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('pairId') pairId: string) {
    return this.competitionsService.removePair(user.clubId, id, pairId)
  }

  @Patch(':id/players/:playerId/payment')
  setPlayerPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('playerId') playerId: string,
    @Body() dto: UpdatePlayerPaymentDto,
  ) {
    return this.competitionsService.setPlayerPayment(user.clubId, id, playerId, dto)
  }

  @Patch(':id/matches/:matchId')
  updateMatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() dto: UpdateMatchDto,
  ) {
    return this.competitionsService.updateMatch(user.clubId, id, matchId, dto)
  }
}

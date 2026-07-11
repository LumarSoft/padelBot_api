import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { PlayersService } from './players.service'
import { QueryPlayersDto } from './dto/query-players.dto'
import { UpdatePlayerDto } from './dto/update-player.dto'

@Controller('players')
@UseGuards(JwtAuthGuard)
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryPlayersDto) {
    return this.playersService.findAll(user.clubId, query)
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.playersService.findOne(user.clubId, id)
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePlayerDto) {
    return this.playersService.update(user.clubId, id, dto)
  }
}

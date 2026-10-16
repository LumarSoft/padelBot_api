import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { CompetitionSignupsService } from './competition-signups.service'
import { QuerySignupRequestsDto } from './dto/query-signup-requests.dto'
import { UpdateSignupRequestDto } from './dto/update-signup-request.dto'

/** The panel's inbox of players who asked the bot to sign up for a torneo or peña. Open to staff. */
@Controller('competition-signup-requests')
@UseGuards(JwtAuthGuard)
export class CompetitionSignupsController {
  constructor(private readonly signups: CompetitionSignupsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QuerySignupRequestsDto) {
    return this.signups.list(user.clubId, query)
  }

  @Patch(':id')
  setStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSignupRequestDto) {
    return this.signups.setStatus(user.clubId, id, dto.status)
  }
}

import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { ChangePasswordDto } from './dto/change-password.dto'

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    this.assertOwner(user)
    return this.usersService.findAll(user.clubId)
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    this.assertOwner(user)
    return this.usersService.create(user.clubId, dto)
  }

  /** Own-password change — available to every authenticated user (OWNER and STAFF). */
  @Post('me/change-password')
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    await this.usersService.changePassword(parseInt(user.id, 10), dto)
    return { changed: true }
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    this.assertOwner(user)
    return this.usersService.update(user.clubId, parseInt(user.id, 10), id, dto)
  }

  @Post(':id/reset-password')
  resetPassword(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    this.assertOwner(user)
    return this.usersService.resetPassword(user.clubId, parseInt(user.id, 10), id)
  }

  private assertOwner(user: AuthenticatedUser): void {
    if (user.role !== 'owner') {
      throw new ForbiddenException('Solo el dueño puede administrar el equipo')
    }
  }
}

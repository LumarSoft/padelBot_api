import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Request } from 'express'
import { AuthService, LoginResult } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { CompleteInitialPasswordDto } from './dto/complete-initial-password.dto'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { CurrentUser } from './decorators/current-user.decorator'
import { AuthenticatedUser } from './types/jwt-payload'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Tight limit to blunt credential brute-force / stuffing: 5 attempts per minute per IP.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.authService.login(dto)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: Request): { user: AuthenticatedUser } {
    return { user: request.user as AuthenticatedUser }
  }

  /**
   * First-login password set for a user on a temporary password. Returns a fresh token so the
   * panel can keep the session (with the `mustChangePassword` claim cleared) instead of
   * re-logging in.
   */
  @Post('me/complete-initial-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  completeInitialPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompleteInitialPasswordDto,
  ): Promise<LoginResult> {
    return this.authService.completeInitialPasswordChange(parseInt(user.id, 10), dto.newPassword)
  }
}

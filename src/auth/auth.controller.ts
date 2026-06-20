import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { AuthService, LoginResult } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { AuthenticatedUser } from './types/jwt-payload'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}

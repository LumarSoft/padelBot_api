import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { Request } from 'express'
import { AuthenticatedUser } from '../types/jwt-payload'

/**
 * Injects the authenticated user (resolved by JwtStrategy) into a handler.
 * Use `@CurrentUser() user: AuthenticatedUser` on guarded routes.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<Request>()
  return request.user as AuthenticatedUser
})

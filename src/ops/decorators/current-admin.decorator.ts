import { ExecutionContext, createParamDecorator } from '@nestjs/common'
import { AuthenticatedOpsAdmin } from '../types/ops-jwt'

/** Reads the authenticated Lumarsoft operator off the request (set by OpsJwtStrategy). */
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedOpsAdmin => {
  return ctx.switchToHttp().getRequest<{ user: AuthenticatedOpsAdmin }>().user
})

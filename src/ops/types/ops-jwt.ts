/**
 * Claims of an ops (platform admin) token. `scope` is asserted on every request, but the
 * real separation is cryptographic: these tokens are signed with OPS_JWT_SECRET, not the
 * tenant JWT_SECRET, so a club's token cannot be presented as an ops token (or the other
 * way round) even if a guard is wired to the wrong strategy.
 */
export interface OpsJwtPayload {
  sub: string
  email: string
  name: string
  scope: 'platform'
}

/** The authenticated Lumarsoft operator attached to the request. */
export interface AuthenticatedOpsAdmin {
  id: string
  email: string
  name: string
}

/** Role as exposed to clients / encoded in the JWT (lowercase). */
export type AuthRole = 'owner' | 'staff'

/** Claims stored in the signed JWT. */
export interface JwtPayload {
  sub: string
  email: string
  name: string
  clubId: string
  clubName: string
  role: AuthRole
  /** True while on a temporary password: the panel forces a change before letting them in. */
  mustChangePassword: boolean
}

/** The authenticated user attached to the request and returned to clients. */
export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  clubId: string
  clubName: string
  role: AuthRole
  /** True while on a temporary password: the panel forces a change before letting them in. */
  mustChangePassword: boolean
}

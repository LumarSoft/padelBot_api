import { randomBytes } from 'crypto'

/**
 * The ops console is OPT-IN: it only exists if OPS_JWT_SECRET is set.
 *
 * When it isn't, we must not take the API down — the clubs' product doesn't depend on our
 * internal console, and booting a whole tenant API to a crash because an ops var is missing
 * would be a self-inflicted outage. So instead the console disables itself: login refuses to
 * mint tokens (503) and the strategy verifies against a random per-process value that
 * nothing was ever signed with, so no token can validate.
 */
const EPHEMERAL_SECRET = randomBytes(32).toString('hex')

export function isOpsEnabled(): boolean {
  return Boolean(process.env.OPS_JWT_SECRET)
}

/** The verification/signing key. Never the ephemeral one when a real secret is configured. */
export function opsJwtSecret(): string {
  return process.env.OPS_JWT_SECRET ?? EPHEMERAL_SECRET
}

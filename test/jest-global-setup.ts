/**
 * Runs the whole test suite on a UTC host, the way production does.
 *
 * The club's wall clock (CLUB_TIMEZONE, Buenos Aires = UTC-3) is a core invariant: any code
 * that formats or buckets a date through the *server's* local timezone instead of the club's
 * is a bug that shows the player the wrong hour. On a developer's machine — which is already
 * in Buenos Aires — such a bug is invisible and every test passes. Pinning TZ here makes the
 * tests fail where production would.
 *
 * Jest forks its workers after this hook, so they inherit TZ.
 */
export default async function globalSetup(): Promise<void> {
  process.env.TZ = 'UTC'
}

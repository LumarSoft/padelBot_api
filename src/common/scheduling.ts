/**
 * Whether this instance should run @Cron/@Interval jobs. Scheduled jobs run in EVERY
 * instance of the API by default, so when scaling horizontally set RUN_SCHEDULER=false
 * on all but one instance to avoid double polling / double notifications.
 * Default true (single-instance deploys need no config).
 */
export function schedulerEnabled(): boolean {
  return (process.env.RUN_SCHEDULER ?? 'true').toLowerCase() !== 'false'
}

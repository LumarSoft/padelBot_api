/**
 * Whether this instance should run @Cron/@Interval jobs. PM2 assigns NODE_APP_INSTANCE
 * (`0`, `1`, …) to cluster workers, so only worker 0 may run scheduled work. This keeps
 * HTTP redundancy without duplicate polling, expirations or notifications. Single-process
 * deployments have no instance id and remain enabled. RUN_SCHEDULER=false disables all jobs.
 */
export function schedulerEnabled(): boolean {
  if ((process.env.RUN_SCHEDULER ?? 'true').toLowerCase() === 'false') return false
  const instanceId = process.env.NODE_APP_INSTANCE
  return instanceId === undefined || instanceId === '0'
}

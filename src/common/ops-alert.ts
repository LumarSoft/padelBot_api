import { Logger } from '@nestjs/common'

const logger = new Logger('OpsAlert')

/**
 * Fire-and-forget message to Lumarsoft's ops channel (Slack/Discord-compatible
 * webhook, env OPS_ALERT_WEBHOOK_URL). Always mirrored to the log, never throws —
 * an alert failure must not break the flow that triggered it.
 */
export async function notifyOps(text: string): Promise<void> {
  logger.log(text)
  const url = process.env.OPS_ALERT_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // "text" (Slack) + "content" (Discord) so either webhook renders it.
      body: JSON.stringify({ text, content: text }),
    })
  } catch (err) {
    logger.error('Failed to deliver ops webhook', err)
  }
}

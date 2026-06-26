/**
 * Runs tasks that share a key strictly one-after-another, while different keys run
 * concurrently. Used to serialize a single WhatsApp number's messages so a burst of
 * rapid messages ("Hola" / "Quiero turno" / "Para hoy") is processed in order — the bot
 * finishes replying to one before reading the next, instead of racing in parallel.
 *
 * In-memory and per-process: it serializes within an instance. Cross-instance safety for
 * the things that matter (no duplicate processing, no double-booking) is handled elsewhere
 * by the webhook-dedup row and the atomic slot lock.
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  /**
   * Appends `task` to `key`'s chain and returns its result. A task's failure never breaks
   * the chain — the next task still runs. The map entry is cleaned up once the chain drains.
   */
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    // `previous` (the prior tail) is a promise that never rejects, so the task always runs.
    const previous = this.tails.get(key) ?? Promise.resolve()
    const run = previous.then(task)
    // Track this as the chain's tail; drop the entry when it settles and nothing newer queued.
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, settled)
    void settled.then(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key)
    })
    return run
  }
}

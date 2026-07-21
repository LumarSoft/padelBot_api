import { KeyedSerialQueue } from './keyed-serial-queue'

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

describe('KeyedSerialQueue', () => {
  it('runs same-key tasks strictly one after another, in order', async () => {
    const queue = new KeyedSerialQueue()
    const events: string[] = []
    let running = 0

    const task = (label: string, delay: number) => async () => {
      running++
      expect(running).toBe(1) // never two same-key tasks at once
      events.push(`start:${label}`)
      await tick(delay)
      events.push(`end:${label}`)
      running--
    }

    // Enqueue out of "speed" order: the first is slow, but must still finish first.
    const a = queue.enqueue('phone', task('a', 20))
    const b = queue.enqueue('phone', task('b', 1))
    const c = queue.enqueue('phone', task('c', 1))
    await Promise.all([a, b, c])

    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
  })

  it('runs different keys concurrently', async () => {
    const queue = new KeyedSerialQueue()
    const order: string[] = []
    const slow = queue.enqueue('p1', async () => {
      await tick(20)
      order.push('p1')
    })
    const fast = queue.enqueue('p2', async () => {
      await tick(1)
      order.push('p2')
    })
    await Promise.all([slow, fast])
    // p2 (different key) finishes first despite being enqueued second.
    expect(order).toEqual(['p2', 'p1'])
  })

  it('keeps the chain alive after a task throws', async () => {
    const queue = new KeyedSerialQueue()
    const ran: string[] = []
    const failing = queue.enqueue('phone', async () => {
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')
    await queue.enqueue('phone', async () => {
      ran.push('next')
    })
    expect(ran).toEqual(['next'])
  })

  it('propagates a task result to its caller', async () => {
    const queue = new KeyedSerialQueue()
    await expect(queue.enqueue('phone', async () => 42)).resolves.toBe(42)
  })
})

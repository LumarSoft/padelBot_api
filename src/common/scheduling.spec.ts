import { schedulerEnabled } from './scheduling'

describe('schedulerEnabled', () => {
  const originalRunScheduler = process.env.RUN_SCHEDULER
  const originalInstance = process.env.NODE_APP_INSTANCE

  afterEach(() => {
    if (originalRunScheduler === undefined) delete process.env.RUN_SCHEDULER
    else process.env.RUN_SCHEDULER = originalRunScheduler

    if (originalInstance === undefined) delete process.env.NODE_APP_INSTANCE
    else process.env.NODE_APP_INSTANCE = originalInstance
  })

  it('enables jobs for a single-process deployment', () => {
    delete process.env.RUN_SCHEDULER
    delete process.env.NODE_APP_INSTANCE
    expect(schedulerEnabled()).toBe(true)
  })

  it('only enables jobs on PM2 cluster worker zero', () => {
    delete process.env.RUN_SCHEDULER
    process.env.NODE_APP_INSTANCE = '0'
    expect(schedulerEnabled()).toBe(true)

    process.env.NODE_APP_INSTANCE = '1'
    expect(schedulerEnabled()).toBe(false)
  })

  it('allows scheduled work to be disabled globally', () => {
    process.env.RUN_SCHEDULER = 'false'
    process.env.NODE_APP_INSTANCE = '0'
    expect(schedulerEnabled()).toBe(false)
  })
})

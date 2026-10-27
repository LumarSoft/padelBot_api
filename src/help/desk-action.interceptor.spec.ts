import { CallHandler, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { DeskAction } from 'generated/prisma/client'
import { lastValueFrom, of, throwError } from 'rxjs'
import { DeskActionInterceptor } from './desk-action.interceptor'
import { HelpService } from './help.service'
import { DeskActionMetadata } from './lib/desk-action.decorator'

/** The interceptor is what turns a real cobro / consumo into a ticked task — and nothing else. */
describe('DeskActionInterceptor', () => {
  function setup(meta: DeskActionMetadata | undefined, request: { user?: { id: string }; body?: unknown }) {
    const recordFirstAction = jest.fn().mockResolvedValue(undefined)
    const reflector = { get: jest.fn().mockReturnValue(meta) } as unknown as Reflector
    const interceptor = new DeskActionInterceptor(reflector, { recordFirstAction } as unknown as HelpService)
    const context = {
      getHandler: () => () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext
    return { interceptor, context, recordFirstAction }
  }

  const ok: CallHandler = { handle: () => of({ ok: true }) }

  it('records the caller once the marked endpoint succeeds', async () => {
    const { interceptor, context, recordFirstAction } = setup(
      { action: DeskAction.DESK_PAYMENT },
      { user: { id: '7' } },
    )
    await expect(lastValueFrom(interceptor.intercept(context, ok))).resolves.toEqual({ ok: true })
    expect(recordFirstAction).toHaveBeenCalledWith(7, DeskAction.DESK_PAYMENT)
  })

  it('ignores endpoints that are not desk actions', async () => {
    const { interceptor, context, recordFirstAction } = setup(undefined, { user: { id: '7' } })
    await lastValueFrom(interceptor.intercept(context, ok))
    expect(recordFirstAction).not.toHaveBeenCalled()
  })

  it('does not count a failed action', async () => {
    const { interceptor, context, recordFirstAction } = setup({ action: DeskAction.RESCHEDULE }, { user: { id: '7' } })
    const failing: CallHandler = { handle: () => throwError(() => new Error('slot taken')) }
    await expect(lastValueFrom(interceptor.intercept(context, failing))).rejects.toThrow('slot taken')
    expect(recordFirstAction).not.toHaveBeenCalled()
  })

  it('does not count an empty bill as loading a consumo', async () => {
    const meta: DeskActionMetadata = {
      action: DeskAction.CONSUMPTION,
      when: (body: { items?: unknown[] }) => (body?.items?.length ?? 0) > 0,
    }
    const empty = setup(meta, { user: { id: '7' }, body: { items: [] } })
    await lastValueFrom(empty.interceptor.intercept(empty.context, ok))
    expect(empty.recordFirstAction).not.toHaveBeenCalled()

    const filled = setup(meta, { user: { id: '7' }, body: { items: [{ productId: 'p1' }] } })
    await lastValueFrom(filled.interceptor.intercept(filled.context, ok))
    expect(filled.recordFirstAction).toHaveBeenCalledWith(7, DeskAction.CONSUMPTION)
  })
})

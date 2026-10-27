import { SetMetadata } from '@nestjs/common'
import { DeskAction } from 'generated/prisma/client'

export const DESK_ACTION_KEY = 'help:deskAction'

export interface DeskActionMetadata {
  action: DeskAction
  /** Only counts when the request body says the action really happened (e.g. a non-empty bill). */
  when?: (body: unknown) => boolean
}

/**
 * Marks an endpoint as a desk action of the "Tu primer día" checklist: once it succeeds for a
 * user, DeskActionInterceptor records that user's first time (UserFirstAction). The handler and
 * its service stay untouched — the checklist must never be able to break the action itself.
 */
export const RecordsDeskAction = (action: DeskAction, when?: DeskActionMetadata['when']) =>
  SetMetadata(DESK_ACTION_KEY, { action, when } satisfies DeskActionMetadata)

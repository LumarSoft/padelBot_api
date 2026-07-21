import { Controller, MessageEvent, Sse, UseGuards } from '@nestjs/common'
import { Observable, map, merge, timer } from 'rxjs'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { AuthenticatedUser } from '../auth/types/jwt-payload'
import { BookingEventsService } from './booking-events.service'

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly events: BookingEventsService) {}

  /**
   * Server-Sent Events stream of booking changes for the caller's club. The
   * admin BFF connects here with the user's JWT and pipes it to the browser.
   */
  @Sse()
  stream(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    const changes$ = this.events.forClub(user.clubId).pipe(map(event => ({ data: event }) as MessageEvent))
    // Heartbeat keeps proxies/load balancers from dropping the idle connection. It's a
    // named 'ping' event, which the browser EventSource ignores. It MUST fire
    // immediately (timer 0): with `interval` the first byte took 25s, so any proxy with
    // a shorter response-header timeout answered 502 before the stream ever started —
    // that was the panel's "SSE 502" bug. 15s cadence stays under common 30s idle cuts.
    const heartbeat$ = timer(0, 15_000).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent))
    return merge(changes$, heartbeat$)
  }
}

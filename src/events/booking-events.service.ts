import { Injectable } from '@nestjs/common'
import { Observable, Subject, filter } from 'rxjs'

export type BookingAction = 'created' | 'cancelled' | 'rescheduled'

/** A change to a club's bookings, broadcast to that club's connected admins. */
export interface BookingEvent {
  type: 'booking.changed'
  clubId: string
  action: BookingAction
  /** Short human label for a toast (e.g. "Juan · Cancha 2 · 21/06 · 18:00–19:30"). */
  summary: string
}

/**
 * In-process pub/sub for booking changes. Producers (BookingsService) call
 * `emit`; the SSE controller subscribes per club via `forClub`.
 *
 * Single API instance only — if the API is ever scaled horizontally, swap the
 * Subject for a Redis pub/sub backing while keeping this same interface, so
 * neither the producers nor the SSE controller need to change.
 */
@Injectable()
export class BookingEventsService {
  private readonly stream$ = new Subject<BookingEvent>()

  emit(event: BookingEvent): void {
    this.stream$.next(event)
  }

  /** Events for a single club only — tenant isolation lives here. */
  forClub(clubId: string): Observable<BookingEvent> {
    return this.stream$.asObservable().pipe(filter(e => e.clubId === clubId))
  }
}

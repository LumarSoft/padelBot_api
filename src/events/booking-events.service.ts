import { Injectable, Logger } from '@nestjs/common'
import { Observable, Subject, filter } from 'rxjs'

export type BookingAction = 'created' | 'cancelled' | 'rescheduled'

export interface BookingEvent {
  type: 'booking.changed'
  clubId: string
  action: BookingAction
  summary: string
}

export interface ConversationEvent {
  type: 'conversation.message'
  clubId: string
  sessionId: string
  waId: string
  playerName: string | null
}

export type AppEvent = BookingEvent | ConversationEvent

@Injectable()
export class BookingEventsService {
  private readonly logger = new Logger(BookingEventsService.name)
  private readonly stream$ = new Subject<AppEvent>()

  emit(event: BookingEvent): void {
    this.publish(event)
  }

  emitConversation(event: ConversationEvent): void {
    this.publish(event)
  }

  /**
   * Notifications are fire-and-forget: `Subject.next` runs subscribers synchronously, so a
   * broken/disconnected SSE consumer (admin panel) must never bubble up and break the
   * booking or bot reply that triggered the event. Failures are logged and swallowed.
   */
  private publish(event: AppEvent): void {
    try {
      this.stream$.next(event)
    } catch (err) {
      this.logger.error('Failed to publish app event', err)
    }
  }

  forClub(clubId: string): Observable<AppEvent> {
    return this.stream$.asObservable().pipe(filter(e => e.clubId === clubId))
  }
}

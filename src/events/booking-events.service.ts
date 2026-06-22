import { Injectable } from '@nestjs/common'
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
  private readonly stream$ = new Subject<AppEvent>()

  emit(event: BookingEvent): void {
    this.stream$.next(event)
  }

  emitConversation(event: ConversationEvent): void {
    this.stream$.next(event)
  }

  forClub(clubId: string): Observable<AppEvent> {
    return this.stream$.asObservable().pipe(filter(e => e.clubId === clubId))
  }
}

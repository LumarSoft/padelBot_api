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

/** A player sent a transfer receipt (RECEIPT mode) — the panel must alert staff to review it. */
export interface PaymentReceiptEvent {
  type: 'payment.receipt'
  clubId: string
  bookingId: string
  summary: string
}

/**
 * A pending booking's payment was just confirmed (the money landed) — either reconciled
 * automatically by the MercadoPago poller or confirmed by hand in the panel. The panel rings
 * the cash alert on this, so staff always hear when a payment comes in, on any screen.
 */
export interface PaymentConfirmedEvent {
  type: 'payment.confirmed'
  clubId: string
  summary: string
  /** "AUTO" = reconciled by the poller; "MANUAL" = an admin confirmed it. */
  source: 'AUTO' | 'MANUAL'
}

export type AppEvent = BookingEvent | ConversationEvent | PaymentReceiptEvent | PaymentConfirmedEvent

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

  emitReceipt(event: PaymentReceiptEvent): void {
    this.publish(event)
  }

  emitPaymentConfirmed(event: PaymentConfirmedEvent): void {
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

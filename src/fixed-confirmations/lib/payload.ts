/**
 * The quick-reply payloads of the "¿venís?" template. Set per message at send time, so a tap
 * says exactly which booking it answers: `FIJO:YES:<bookingId>` / `FIJO:NO:<bookingId>`.
 *
 * Not signed on purpose: the payload alone authorizes nothing. The handler only acts when the
 * booking belongs to the club whose line received the tap AND to the number that tapped.
 */

export type AttendanceAnswer = 'YES' | 'NO'

const PREFIX = 'FIJO'
const PAYLOAD = /^FIJO:(YES|NO):([A-Za-z0-9_-]{1,64})$/

export function buildAttendancePayload(answer: AttendanceAnswer, bookingId: string): string {
  return `${PREFIX}:${answer}:${bookingId}`
}

/** The answer and booking a payload carries, or null when it isn't one of ours. */
export function parseAttendancePayload(
  payload?: string | null,
): { answer: AttendanceAnswer; bookingId: string } | null {
  const match = PAYLOAD.exec((payload ?? '').trim())
  if (!match) return null
  return { answer: match[1] as AttendanceAnswer, bookingId: match[2] }
}

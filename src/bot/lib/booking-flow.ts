import { BandCourt, BandOption, BotState, CourtOption, HandlerResult, SessionContext, SlotOption } from '../types'
import { confirmBooking, courtsAtTimeList, dayAvailabilityList, timeNotAvailable } from '../messages'

// Time-first booking flow: the player picks a TIME from the day's availability and the bot
// assigns a free court (auto when there's one, or asks only when several courts share that
// time). These pure helpers derive the next FSM step + context from `ctx.dayAvailability`, so
// both the deterministic handlers (bot.service) and the LLM dispatcher (llm.service) behave
// identically — and a band is only ever offered with courts that are actually free.

/** One representative slot per band (cheapest court) — feeds the botonera + `matchSlot`. */
export function bandsToSlotOptions(bands: BandOption[]): SlotOption[] {
  return bands.map(b => ({
    bandStart: b.bandStart,
    label: b.label,
    price: Math.min(...b.courts.map(c => c.price)),
  }))
}

/** The distinct courts appearing across the day's bands. */
export function courtsFromBands(bands: BandOption[]): CourtOption[] {
  const seen = new Map<string, string>()
  for (const band of bands) for (const c of band.courts) if (!seen.has(c.id)) seen.set(c.id, c.name)
  return [...seen.entries()].map(([id, name]) => ({ id, name }))
}

/** Drops any stale per-court/slot selection so a fresh availability view isn't tainted. */
function clearSelection(ctx: SessionContext): SessionContext {
  return {
    ...ctx,
    selectedCourtId: undefined,
    selectedCourtName: undefined,
    selectedSlotId: undefined,
    selectedBandStart: undefined,
    selectedSlotLabel: undefined,
    selectedSlotPrice: undefined,
    courtOptions: undefined,
  }
}

/** Stores the day's availability and shows it (grouped by court), landing on BOOK_SLOT. */
export function availabilityResult(ctx: SessionContext, bands: BandOption[], dateKey: string): HandlerResult {
  const next: SessionContext = {
    ...clearSelection(ctx),
    selectedDate: dateKey,
    dayAvailability: bands,
    slotOptions: bandsToSlotOptions(bands),
  }
  return { reply: dayAvailabilityList(bands, dateKey), state: BotState.BOOK_SLOT, ctx: next }
}

function confirmFor(ctx: SessionContext, band: BandOption, court: BandCourt): HandlerResult {
  const next: SessionContext = {
    ...ctx,
    selectedCourtId: court.id,
    selectedCourtName: court.name,
    selectedSlotId: court.slotId,
    selectedBandStart: band.bandStart,
    selectedSlotLabel: band.label,
    selectedSlotPrice: court.price,
  }
  return { reply: confirmBooking(next), state: BotState.BOOK_CONFIRM, ctx: next }
}

/**
 * Resolves a chosen time band: auto-assign when one court is free, or ask which court when
 * several are. Re-shows availability if the band is somehow no longer free.
 */
export function resolveBand(ctx: SessionContext, bandStart: string): HandlerResult {
  const bands = ctx.dayAvailability ?? []
  const band = bands.find(b => b.bandStart === bandStart)
  if (!band || band.courts.length === 0) {
    return { reply: timeNotAvailable(bands, ctx.selectedDate!), state: BotState.BOOK_SLOT, ctx }
  }
  if (band.courts.length === 1) return confirmFor(ctx, band, band.courts[0])

  const next: SessionContext = {
    ...ctx,
    selectedBandStart: band.bandStart,
    selectedSlotLabel: band.label,
    courtOptions: band.courts.map(c => ({ id: c.id, name: c.name })),
    selectedCourtId: undefined,
    selectedCourtName: undefined,
    selectedSlotId: undefined,
    selectedSlotPrice: undefined,
  }
  return {
    reply: courtsAtTimeList(
      band.courts.map(c => ({ name: c.name, price: c.price })),
      band.label,
      ctx.selectedDate!,
    ),
    state: BotState.BOOK_COURT,
    ctx: next,
  }
}

/** Assigns the cheapest free court for a band (the "cualquiera" choice). */
export function assignCheapestForBand(ctx: SessionContext, bandStart: string): HandlerResult {
  const bands = ctx.dayAvailability ?? []
  const band = bands.find(b => b.bandStart === bandStart)
  if (!band || band.courts.length === 0) {
    return { reply: timeNotAvailable(bands, ctx.selectedDate!), state: BotState.BOOK_SLOT, ctx }
  }
  const cheapest = [...band.courts].sort((a, b) => a.price - b.price)[0]
  return confirmFor(ctx, band, cheapest)
}

/** Confirms the already-chosen time on a specific court, or null if it's no longer free there. */
export function resolveCourtAtBand(ctx: SessionContext, court: CourtOption): HandlerResult | null {
  const band = (ctx.dayAvailability ?? []).find(b => b.bandStart === ctx.selectedBandStart)
  const bandCourt = band?.courts.find(c => c.id === court.id)
  if (!band || !bandCourt) return null
  return confirmFor(ctx, band, bandCourt)
}

/** True for "cualquiera / la que sea / me da igual" — the player doesn't care which court. */
export function isAnyCourt(msg: string): boolean {
  const t = msg
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
  return /\b(cualquiera|cualquier|la que sea|el que sea|me da igual|me es igual|indistinto|no importa|donde sea)\b/.test(
    t,
  )
}

/** A rough "this looks like a clock time" check (and not a court reference). */
export function mentionsTime(msg: string): boolean {
  if (/cancha/i.test(msg)) return false
  return /\d{1,2}/.test(msg)
}

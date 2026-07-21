import { CLUB_TIMEZONE } from '../availability/lib/datetime'
import { CourtSchedule, generateBands } from '../availability/lib/schedule'
import { BotState, SessionContext } from '../bot/types'

/** A court as the prompt needs it: its name plus its real schedule config. */
export interface PromptCourt extends CourtSchedule {
  name: string
}

export interface SystemPromptParams {
  clubName: string
  courts: PromptCourt[]
  currentDate: string
  state: BotState
  playerName?: string
  ctx: SessionContext
}

/**
 * Static, club-agnostic part of the system prompt. Kept as a stable module-level
 * constant and placed FIRST so OpenAI's automatic prompt caching can reuse it
 * across every call and every club (the cache keys on the longest identical
 * prefix). All per-call variable data (club, date, conversation) goes AFTER this.
 */
const STATIC_PREFIX = `Sos *GTP*, el asistente virtual de un club de pádel.
Gestionás reservas por WhatsApp de forma clara, rápida y confiable: reservar un turno
y responder preguntas generales del club.

⚠️ Cada club tiene SU propio horario y duración de turno — más abajo van los de este club.
Nunca supongas un esquema de franjas: usá solo el que te pasan. Y ese esquema es el horario de
operación, NO la disponibilidad: qué está libre solo lo sabés llamando a navigate_booking.
Jamás listes franjas como si fueran turnos libres.

━━━ REGLAS ABSOLUTAS ━━━
1. Nunca confirmes una reserva sin confirmación explícita del jugador.
2. Nunca compartas datos de otros jugadores (nombre, teléfono, reservas ajenas).
3. Nunca inventes precios, disponibilidad ni características que no tenés en el contexto.
4. Nunca hables de temas ajenos al club y las reservas de pádel.
5. Si algo no se puede, decilo claro y ofrecé una alternativa real.

━━━ TONO ━━━
• Hablás como una persona real del club: cálido, cercano y canchero, no como un menú.
• Rioplatense informal pero profesional (usá "vos"). Mensajes cortos, una o dos frases.
• Variá las respuestas, no leas un guion. Emojis con moderación (🎾 📅 ✅ ❌ 👤).
• Priorizá empatía si hay confusión. Nunca menciones opciones numéricas ni estados internos.
• No preguntes lo que ya sabés del contexto o del historial. Anticipá el próximo paso.

━━━ FUNCIONES ━━━
navigate_booking → el jugador quiere reservar, pregunta qué hay para una fecha, o menciona/elige
fecha u horario en contexto de reserva. Extraé del mensaje y del historial todo lo posible.
El jugador NO necesita elegir cancha: el sistema le muestra los horarios libres y le asigna una
cancha sola (solo pregunta cuál si el mismo horario está libre en varias). Pasá courtName solo si
el jugador pide una cancha puntual; si menciona una hora, pasá siempre timePreference.
Texto (sin función) → saludos, agradecimientos y preguntas generales sin fecha específica.

⚠️ Ver o CANCELAR turnos ya reservados lo maneja el sistema, no vos. Si el jugador quiere ver
sus turnos, cancelar uno, o dice que no va a poder ir, decile que responda *mis turnos* y él
solo elige cuál. Nunca le digas que le escriba al club para eso, ni prometas cancelarlo vos.

━━━ CASOS ESPECIALES ━━━
• "¿Cuánto cuesta?" → el precio aparece al elegir el turno; no lo inventes.
• "¿Cancha cubierta?" → respondé con los nombres que conocés, sin inventar características.
• "¿Tenés a las 18?" → llamá a navigate_booking con esa hora; el sistema dice si hay y en qué cancha.
• "Mañana / el sábado / la semana que viene" → calculá la fecha y llamá a navigate_booking.
• Lenguaje inapropiado o datos de terceros → redirigí con calma; no compartas datos ajenos.`

export function buildSystemPrompt(params: SystemPromptParams): string {
  const { clubName, courts, currentDate, state, playerName, ctx } = params

  const playerLine = playerName ? `Jugador actual: *${playerName}*` : 'Nombre del jugador: desconocido'
  const stateCtx = buildStateContext(state, ctx)

  // STATIC_PREFIX first (cacheable), variable data last.
  return `${STATIC_PREFIX}

━━━ DATOS DEL CLUB ━━━
Club: *${clubName}*
Fecha y hora actual: ${currentDate}
Canchas y franjas (esquema, NO disponibilidad):
${describeSchedule(courts)}

━━━ CONVERSACIÓN ACTUAL ━━━
${playerLine}
${stateCtx}`
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The club's REAL bands, per court, straight from its configuration.
 *
 * This used to be a constant in the static prefix (09:00–00:00, 90-minute bands). Every club
 * that opens earlier, closes later or rents 60-minute turns had an LLM reasoning about a grid
 * that doesn't exist — and mapping "mañana temprano" onto a band the club never offers. The
 * bands are derived from the same schedule module the availability layer uses, so the prompt
 * can't drift from reality.
 *
 * Per-weekday overrides (`weeklyHours`) are deliberately NOT expanded here: the default hours
 * are enough for the LLM to map "las 6 de la tarde" onto a plausible band start, and the real
 * answer for any given day always comes back from navigate_booking.
 */
function describeSchedule(courts: PromptCourt[]): string {
  if (courts.length === 0) return '  (Sin canchas configuradas)'

  return courts
    .map(court => {
      const starts = generateBands(court.openTime, court.closeTime, court.slotDurationMinutes).map(b => b.start)
      if (starts.length === 0) return `  • ${court.name}: sin franjas configuradas`
      return `  • ${court.name} (turnos de ${court.slotDurationMinutes} min): ${starts.join(' · ')}`
    })
    .join('\n')
}

function buildStateContext(state: BotState, ctx: SessionContext): string {
  const parts: string[] = []
  if (ctx.selectedDate) parts.push(`Fecha: ${ctx.selectedDate}`)
  if (ctx.selectedCourtName) parts.push(`Cancha: ${ctx.selectedCourtName}`)
  if (ctx.selectedSlotLabel) parts.push(`Horario: ${ctx.selectedSlotLabel}`)

  const base = parts.length > 0 ? `Datos recopilados — ${parts.join(' | ')}` : ''

  switch (state) {
    case BotState.BOOK_DATE:
      return `El jugador está eligiendo la fecha de su reserva. ${base}`
    case BotState.BOOK_NAME:
      return `Esperando que el jugador ingrese su nombre para continuar con la reserva. ${base}`
    case BotState.BOOK_COURT:
      return `El horario ya está elegido y está libre en varias canchas; el jugador elige cuál (o "cualquiera"). ${base}`
    case BotState.BOOK_SLOT:
      return `El jugador está eligiendo el horario; el sistema le asigna una cancha libre. ${base}`
    case BotState.BOOK_CONFIRM:
      return `El jugador está confirmando su reserva. ${base}`
    default:
      return base
  }
}

export function formatCurrentDate(): string {
  // Pinned to the club timezone so the LLM resolves "mañana", "el sábado", etc.
  // against the club's wall clock regardless of where the API server runs.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLUB_TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''

  const days: Record<string, string> = {
    Sun: 'Domingo',
    Mon: 'Lunes',
    Tue: 'Martes',
    Wed: 'Miércoles',
    Thu: 'Jueves',
    Fri: 'Viernes',
    Sat: 'Sábado',
  }
  const months = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ]
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${days[get('weekday')]} ${Number(get('day'))} de ${months[Number(get('month')) - 1]} de ${get('year')}, ${hour}:${get('minute')}`
}

import { CLUB_TIMEZONE } from '../availability/lib/datetime'
import { BotState, SessionContext } from '../bot/types'

export interface SystemPromptParams {
  clubName: string
  courtNames: string[]
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
const STATIC_PREFIX = `Sos *PadelBot*, el asistente virtual de un club de pádel.
Gestionás reservas por WhatsApp de forma clara, rápida y confiable: reservar un turno
y responder preguntas generales del club.

━━━ ESQUEMA DE FRANJAS (horario de operación, NO disponibilidad real) ━━━
  09:00–10:30 · 10:30–12:00 · 12:00–13:30 · 13:30–15:00 · 15:00–16:30
  16:30–18:00 · 18:00–19:30 · 19:30–21:00 · 21:00–22:30 · 22:30–00:00
⚠️ Es el esquema fijo del club, no qué hay libre. La disponibilidad real solo la sabés
al llamar a navigate_booking; nunca la respondas de memoria ni listes estas franjas como turnos libres.

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

━━━ CASOS ESPECIALES ━━━
• "¿Cuánto cuesta?" → el precio aparece al elegir el turno; no lo inventes.
• "¿Cancha cubierta?" → respondé con los nombres que conocés, sin inventar características.
• "¿Tenés a las 18?" → llamá a navigate_booking con esa hora; el sistema dice si hay y en qué cancha.
• "Mañana / el sábado / la semana que viene" → calculá la fecha y llamá a navigate_booking.
• Lenguaje inapropiado o datos de terceros → redirigí con calma; no compartas datos ajenos.`

export function buildSystemPrompt(params: SystemPromptParams): string {
  const { clubName, courtNames, currentDate, state, playerName, ctx } = params

  const courtsBlock =
    courtNames.length > 0 ? courtNames.map((n, i) => `  ${i + 1}. ${n}`).join('\n') : '  (Sin canchas configuradas)'

  const playerLine = playerName ? `Jugador actual: *${playerName}*` : 'Nombre del jugador: desconocido'

  const stateCtx = buildStateContext(state, ctx)

  // STATIC_PREFIX first (cacheable), variable data last.
  return `${STATIC_PREFIX}

━━━ DATOS DEL CLUB ━━━
Club: *${clubName}*
Fecha y hora actual: ${currentDate}
Canchas:
${courtsBlock}

━━━ CONVERSACIÓN ACTUAL ━━━
${playerLine}
${stateCtx}`
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

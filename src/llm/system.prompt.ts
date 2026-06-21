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

export function buildSystemPrompt(params: SystemPromptParams): string {
  const { clubName, courtNames, currentDate, state, playerName, ctx } = params

  const courtsBlock =
    courtNames.length > 0 ? courtNames.map((n, i) => `  ${i + 1}. ${n}`).join('\n') : '  (Sin canchas configuradas)'

  const playerLine = playerName ? `Jugador actual: *${playerName}*` : 'Nombre del jugador: desconocido'

  const stateCtx = buildStateContext(state, ctx)

  return `Sos *PadelBot*, el asistente virtual de *${clubName}*.
Tu función es gestionar reservas de pádel por WhatsApp de forma clara, rápida y confiable.

━━━ CAPACIDADES ━━━
• Reservar un turno disponible
• Consultar las reservas confirmadas del jugador
• Cancelar una reserva existente del jugador
• Responder preguntas generales sobre el club y el servicio

━━━ DATOS DEL CLUB ━━━
Fecha y hora actual: ${currentDate}
Canchas disponibles:
${courtsBlock}

Esquema de franjas horarias del club (horario de operación — NO es disponibilidad real):
  09:00–10:30 | 10:30–12:00 | 12:00–13:30 | 13:30–15:00 | 15:00–16:30
  16:30–18:00 | 18:00–19:30 | 19:30–21:00 | 21:00–22:30 | 22:30–00:00
⚠️ Estos horarios son el esquema fijo del club. La disponibilidad real (qué turnos quedan libres) solo la conocés al llamar a navigate_booking — nunca la respondas de memoria.

━━━ CONVERSACIÓN ACTUAL ━━━
${playerLine}
${stateCtx}

━━━ REGLAS ABSOLUTAS — NUNCA ROMPERLAS ━━━
1. Jamás confirmes una reserva o cancelación sin que el jugador lo confirme explícitamente.
2. Jamás compartas datos de otros jugadores: nombre, teléfono, horarios de reservas ajenas.
3. Nunca inventes precios, disponibilidad o información que no tenés en este contexto.
4. Nunca respondas sobre temas ajenos al club y las reservas de pádel.
5. Si el jugador pide algo que no podés hacer, decilo claro y ofrecé alternativas reales.
6. NUNCA respondas con la lista de franjas horarias como si fueran turnos disponibles para una fecha — esos son datos del esquema del club, no disponibilidad en tiempo real. Para eso existe navigate_booking.

━━━ TONO Y ESTILO ━━━
• Hablás como una persona real del club, no como un robot ni un menú. Cálido, cercano y canchero.
• Español rioplatense informal pero profesional (usá "vos", no "tú").
• Mensajes cortos y directos — estás en WhatsApp, no en un correo. Una o dos frases alcanzan.
• Variá tus respuestas: no repitas siempre la misma frase ni leas un guion.
• Emojis con moderación: 🎾 📅 ✅ ❌ 👤 son suficientes.
• Si el jugador está confundido o frustrado, priorizar empatía antes que información.
• Nunca uses tecnicismos, números de opción rígidos ("respondé 1") ni menciones estados internos del sistema.
• El flujo debe sentirse natural: no preguntes lo que ya sabés del contexto o del historial.

━━━ PROACTIVIDAD ━━━
• Nunca dejes al jugador en un callejón sin salida. Si algo no se puede, ofrecé siempre una alternativa concreta.
• Si una fecha no tiene lugar, el sistema ya le ofrece los días más cercanos con turnos: acompañá esa lógica, no contradigas ni inventes disponibilidad.
• Anticipá el próximo paso: si ya tenés fecha y cancha, encaminá hacia el horario sin dar vueltas.

━━━ USO DE FUNCIONES ━━━
Llamá a navigate_booking cuando:
  • El jugador quiere reservar un turno (con o sin todos los datos)
  • El jugador pregunta qué hay disponible para una fecha específica
  • El jugador menciona un horario o cancha en el contexto de una reserva
  • El jugador elige un horario o cancha en la conversación (aunque no diga "quiero reservar")
  Siempre extraé del mensaje y del historial todo lo que puedas: fecha, cancha y hora.

  • Ver reservas  →  navigate_my_bookings
  • Cancelar      →  navigate_cancel

NO uses funciones cuando:
  • Es una pregunta general (precios, canchas, normas) sin fecha específica → respondé con texto.
  • Es un saludo, agradecimiento o mensaje corto → respondé cordialmente.

━━━ MANEJO DE CASOS ESPECIALES ━━━
• "¿Cuánto cuesta?" → No tenés los precios exactos. Indicá que el precio aparece al elegir el turno, o que consulte en el club.
• "¿Tienen cancha cubierta?" → Respondé con los nombres de canchas que conocés. No inventes características.
• "Quiero cambiar/modificar mi reserva" → Explicá que debe cancelar la actual y hacer una nueva. Ofrecé ayuda para ambos pasos.
• "Reservar para mañana / el sábado / la semana que viene" → Calculá la fecha con la fecha actual y llamá a navigate_booking.
• Lenguaje inapropiado → Respondé con calma y profesionalismo, redirigiendo al tema del club.
• Preguntas sobre otros jugadores → Negá la información y explicá que no podés compartir datos de terceros.`
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
      return `El jugador está eligiendo la cancha. ${base}`
    case BotState.BOOK_SLOT:
      return `El jugador está eligiendo el horario. ${base}`
    case BotState.BOOK_CONFIRM:
      return `El jugador está confirmando su reserva. ${base}`
    case BotState.CANCEL_SELECT:
      return 'El jugador está eligiendo cuál reserva cancelar.'
    case BotState.CANCEL_CONFIRM:
      return `El jugador está confirmando la cancelación de: ${ctx.selectedBookingLabel ?? ''}`
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

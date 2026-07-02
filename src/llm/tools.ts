import { ChatCompletionTool } from 'openai/resources'

export const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'navigate_booking',
      description:
        'Usá esta función cuando: (1) el jugador quiere reservar un turno, ' +
        '(2) pregunta qué hay disponible para una fecha específica, ' +
        '(3) menciona o elige un horario/cancha en el contexto de una reserva. ' +
        'Extraé del mensaje Y del historial de conversación todo lo que puedas: fecha, cancha y hora.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description:
              'Fecha en formato YYYY-MM-DD. ' +
              'Calculá a partir de expresiones relativas ("mañana", "el sábado", "la semana que viene") ' +
              'usando la fecha actual del system prompt. Si no se menciona fecha, omitir.',
          },
          courtName: {
            type: 'string',
            description: 'Nombre de la cancha tal como la mencionó el jugador. Omitir si no se mencionó.',
          },
          timePreference: {
            type: 'string',
            description:
              'Hora preferida en formato HH:MM. ' +
              'Mapeá expresiones como "6 de la tarde" → "18:00", "mediodía" → "12:00", "mañana temprano" → "09:00". ' +
              'Omitir si no se mencionó hora.',
          },
        },
      },
    },
  },
]

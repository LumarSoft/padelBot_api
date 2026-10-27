import { dayLabelFromKey, formatTime, shiftDateKey, toDateKey, todayKey } from '../../availability/lib/datetime'

/** How a turno is named to the player: "hoy" / "mañana" / "el jueves 16/10", plus its time and court. */
export interface TurnoWhen {
  /** "hoy", "mañana" or "el jueves 16/10" — reads after "tu turno fijo …" / "te esperamos …". */
  day: string
  /** "de hoy", "de mañana" or "del jueves 16/10" — reads after "tu turno …". */
  ofDay: string
  time: string
  court: string
}

export function describeTurno(startsAt: Date, courtName: string): TurnoWhen {
  const dateKey = toDateKey(startsAt)
  const today = todayKey()
  const time = formatTime(startsAt)
  if (dateKey === today) return { day: 'hoy', ofDay: 'de hoy', time, court: courtName }
  if (dateKey === shiftDateKey(today, 1)) return { day: 'mañana', ofDay: 'de mañana', time, court: courtName }
  const label = dayLabelFromKey(dateKey)
  return { day: `el ${label}`, ofDay: `del ${label}`, time, court: courtName }
}

/**
 * Template body params must be a single line: Meta rejects newlines, tabs and runs of spaces.
 * Names come from the panel as typed, so flatten them.
 */
export function templateParam(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export const attendanceReplies = {
  confirmed: (when: TurnoWhen) =>
    `¡Genial! 🙌 Te esperamos ${when.day} a las ${when.time} en ${when.court}. ¡Buen partido! 🎾`,

  released: (when: TurnoWhen) =>
    `Listo, gracias por avisar 👍 Liberamos tu turno ${when.ofDay} a las ${when.time} en ${when.court} ` +
    `para que lo pueda usar otra persona.\n\nTu turno fijo sigue igual las próximas semanas.`,

  alreadyReleased: (when: TurnoWhen) =>
    `Ya lo teníamos 👍 Tu turno ${when.ofDay} a las ${when.time} quedó liberado. ` +
    `Tu turno fijo sigue igual las próximas semanas.`,

  /** "Sí, voy" after having said "No puedo": the court may already be someone else's. */
  comingAfterRelease: (when: TurnoWhen) =>
    `Habías avisado que no venías, así que liberamos la cancha ${when.ofDay} a las ${when.time}. ` +
    `Si al final podés, escribinos por acá y vemos si sigue libre. 🙌`,

  cancelledByClub: () => 'Ese turno ya no figura como reservado. Si tenés alguna duda, escribinos por acá. 🙌',

  past: () => 'Ese turno ya pasó. ¡Nos vemos en el próximo! 🎾',

  notFound: () => 'No encontramos ese turno a tu nombre. Si necesitás algo, escribinos por acá. 🙌',
}

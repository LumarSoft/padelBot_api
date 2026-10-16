import { dayLabelFromKey } from '../../availability/lib/datetime'
import type { OpenCompetition } from '../../competitions/competition-signups.service'
import { MENU } from '../messages'
import { BotState, COMPETITION_PREFIX, CompetitionOption, HandlerResult, SessionContext } from '../types'

/** No torneo or peña is taking registrations — back to the menu. */
export const NO_OPEN_COMPETITIONS = `Por ahora no hay torneos ni peñas con inscripción abierta 🎾 Cuando se arme uno, te lo muestro acá.\n\n${MENU}`

/** The player picked one: the club takes it from here. */
export function signupRequested(name: string): string {
  return `¡Buenísimo! 🙌 Le aviso al equipo del club que te querés anotar a *${name}*. Te escriben por acá en un rato para completar la inscripción. 🎾`
}

/** They had already asked for this one and nobody has answered yet. */
export function signupAlreadyRequested(name: string): string {
  return `Ya le avisé al club que te querés anotar a *${name}* 🙌 Te escriben por acá en un rato. 🎾`
}

/** The event closed its registration between the list and the tap. */
export function competitionClosed(name: string): string {
  return `Uy, *${name}* ya no tiene la inscripción abierta 😕`
}

function feeLabel(cents: number): string {
  return cents > 0 ? `$${(cents / 100).toLocaleString('es-AR')} por jugador` : 'sin costo'
}

/** Data from the competitions module → what the bot shows and remembers. */
export function toCompetitionOptions(open: OpenCompetition[]): CompetitionOption[] {
  return open.map(c => {
    const more = c.sessionCount > 1 ? ` (+${c.sessionCount - 1} ${c.sessionCount === 2 ? 'día' : 'días'})` : ''
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      when: `${dayLabelFromKey(c.dateKey)} · ${c.startTime}${more}`,
      feeCents: c.entryFeeCents,
      categories: c.categories,
    }
  })
}

/** The full numbered list (sent as plain text when no WhatsApp list fits). */
export function competitionsList(options: CompetitionOption[]): string {
  const lines = options.map((c, i) => {
    const kind = c.kind === 'PENA' ? 'Peña' : 'Torneo'
    const categories = c.categories.length ? `\n   Categorías: ${c.categories.join(', ')}` : ''
    return `*${i + 1}.* ${kind} *${c.name}*\n   ${c.when} · ${feeLabel(c.feeCents)}${categories}`
  })
  return `🏆 Estos son los torneos y peñas con inscripción abierta:\n\n${lines.join('\n\n')}\n\n¿A cuál te querés anotar? Respondé con el número.`
}

/** The listing step: the picker, or back to the menu when there's nothing open. */
export function competitionsResult(options: CompetitionOption[], ctx: SessionContext): HandlerResult {
  if (options.length === 0) {
    return { reply: NO_OPEN_COMPETITIONS, state: BotState.MENU, ctx: { ...ctx, competitionOptions: undefined } }
  }
  return {
    reply: competitionsList(options),
    state: BotState.COMPETITION_PICK,
    ctx: { ...ctx, competitionOptions: options },
  }
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/**
 * Which listed event the player meant: a tapped row ("torneo:<id>"), its number ("2", "la 2"),
 * or its name ("el primavera"). Null when it can't tell — the LLM gets a go at it then.
 */
export function matchCompetition(msg: string, options: CompetitionOption[]): CompetitionOption | null {
  if (msg.startsWith(COMPETITION_PREFIX)) {
    const id = msg.slice(COMPETITION_PREFIX.length)
    return options.find(o => o.id === id) ?? null
  }

  const text = normalize(msg)
  const number = text.match(/^(?:el |la |al |a la |opcion |numero |nro )?(\d{1,2})\b/)
  if (number) return options[Number(number[1]) - 1] ?? null

  const byName = options.filter(o => {
    const name = normalize(o.name)
    return text === name || (text.length >= 4 && (name.includes(text) || text.includes(name)))
  })
  return byName.length === 1 ? byName[0] : null
}

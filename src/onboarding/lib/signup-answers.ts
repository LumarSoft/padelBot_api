/**
 * Allowed values for the choice questions of the step-by-step signup at `/register`.
 * Kept here (not as Prisma enums) because these are pre-sales answers, not domain state:
 * they get read by a human before a call, and we want to add or reword an option without
 * a migration. The DTO validates against these lists, so the DB never holds anything else.
 */
export const COURT_TYPES = ['INDOOR', 'OUTDOOR', 'MIXED'] as const
export const CHARGES_DEPOSIT = ['ALWAYS', 'SOMETIMES', 'NEVER'] as const
export const HAS_MERCADOPAGO = ['YES', 'NO', 'UNSURE'] as const
export const CURRENT_SYSTEMS = ['PAPER', 'WHATSAPP', 'SPREADSHEET', 'SOFTWARE'] as const
export const BIGGEST_PAINS = ['REPLYING', 'DEPOSITS', 'CHANGES', 'FIXED_SLOTS', 'OTHER'] as const
export const FIXED_SLOTS = ['NONE', 'FEW', 'SOME', 'MANY'] as const
export const HOW_FOUND = ['INSTAGRAM', 'REFERRAL', 'GOOGLE', 'OTHER_CLUB', 'OTHER'] as const
/** 'ANY' is legacy — the form now offers 'CUSTOM' plus a free-text window instead. */
export const CONTACT_WINDOWS = ['MORNING', 'AFTERNOON', 'EVENING', 'CUSTOM', 'ANY'] as const

/** Human-readable Spanish for the ops alert — we read this before calling the club. */
export const ANSWER_LABELS: Record<string, string> = {
  INDOOR: 'todas techadas',
  OUTDOOR: 'todas al aire libre',
  MIXED: 'mezcla de techadas y descubiertas',

  ALWAYS: 'siempre cobra seña',
  SOMETIMES: 'cobra seña a veces',
  NEVER: 'no cobra seña (se paga al llegar)',

  YES: 'sí',
  NO: 'no',
  UNSURE: 'no sabe',

  PAPER: 'cuaderno / papel',
  WHATSAPP: 'WhatsApp a mano',
  SPREADSHEET: 'Excel / planilla',
  SOFTWARE: 'otro software',

  REPLYING: 'contestar WhatsApp todo el día',
  DEPOSITS: 'perseguir las señas',
  CHANGES: 'cambios y cancelaciones',
  FIXED_SLOTS: 'manejar los turnos fijos',
  OTHER: 'otra cosa',

  NONE: 'ninguno',
  FEW: 'entre 1 y 10',
  SOME: 'entre 11 y 25',
  MANY: 'más de 25',

  INSTAGRAM: 'Instagram',
  REFERRAL: 'recomendación',
  GOOGLE: 'Google',
  OTHER_CLUB: 'otro club',

  MORNING: 'a la mañana (9–13)',
  AFTERNOON: 'a la tarde (13–19)',
  EVENING: 'a la noche (19–22)',
  CUSTOM: 'en un horario puntual',
  ANY: 'en cualquier momento',
}

export function answerLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return ANSWER_LABELS[value] ?? value
}

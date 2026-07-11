/**
 * The guided account setup ("puesta a punto") a new club walks through at `/setup`.
 *
 * Every step is SKIPPABLE and re-editable from Configuración afterwards — the wizard is a
 * guided path over the same endpoints the panel already exposes, never a gate. What makes a
 * step "done" is always derived from real data (see OnboardingService.getStatus), so a club
 * configured by hand shows up as done without ever opening the wizard.
 */
export const SETUP_STEP_IDS = [
  'complejo',
  'canchas',
  'pagos',
  'whatsapp',
  'fijos',
  'equipo',
  'kiosco',
] as const

export type SetupStepId = (typeof SETUP_STEP_IDS)[number]

/**
 * Steps the bot cannot work without: no courts = nothing to book, no payment config = it
 * can't ask for the seña, no WhatsApp line = it can't resolve the tenant of an incoming
 * message. The rest enrich the club but the bot runs without them.
 */
export const REQUIRED_STEP_IDS: readonly SetupStepId[] = ['canchas', 'pagos', 'whatsapp']

export function isSetupStepId(value: unknown): value is SetupStepId {
  return typeof value === 'string' && (SETUP_STEP_IDS as readonly string[]).includes(value)
}

/** Advisory wizard position, persisted on `Club.setupProgress`. */
export interface SetupProgress {
  /** Step to resume on when the owner comes back. */
  currentStep: SetupStepId | null
  /** Steps the owner explicitly moved past (including ones they chose to skip). */
  doneSteps: SetupStepId[]
}

/** Parses the untrusted `Club.setupProgress` JSON blob, dropping anything unrecognized. */
export function parseSetupProgress(raw: unknown): SetupProgress {
  const empty: SetupProgress = { currentStep: null, doneSteps: [] }
  if (!raw || typeof raw !== 'object') return empty

  const value = raw as Record<string, unknown>
  const doneSteps = Array.isArray(value.doneSteps) ? value.doneSteps.filter(isSetupStepId) : []

  return {
    currentStep: isSetupStepId(value.currentStep) ? value.currentStep : null,
    doneSteps: [...new Set(doneSteps)],
  }
}

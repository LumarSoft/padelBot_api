import { cheapestPlanWith, PlanFeature } from './plans'

/** How the panel and the refusals name each module (the landing's wording). */
export const FEATURE_LABELS: Record<PlanFeature, string> = {
  fixedConfirmation: 'La confirmación de fijos por WhatsApp',
  kioscoStock: 'El control de stock del kiosco',
  waitlist: 'La lista de espera',
  splitPayment: 'El cobro dividido entre jugadores',
  scheduledPriceAdjustments: 'Programar aumentos de precio',
}

/**
 * The refusal when a club tries to turn on a module its plan doesn't include. Only turning it
 * ON is refused: whatever the club already had running keeps working.
 */
export function featureLockedMessage(feature: PlanFeature): string {
  return `${FEATURE_LABELS[feature]} viene con el plan ${cheapestPlanWith(feature).name}. Escribinos y te lo activamos.`
}

/** Without split payment the desk still charges the turno — in one payment for the whole bill. */
export function splitPaymentLockedMessage(): string {
  return `${featureLockedMessage('splitPayment')} Con tu plan, registrá el turno completo en un solo pago.`
}

import { nextPlanWithRoom, PlanDefinition } from './plans'

/**
 * The refusals of the soft limits, written for the owner who hits them in the panel: what the
 * plan includes and which plan has room. Nothing the club already has is touched; only adding
 * one more is refused.
 */

/** (2, 'cancha') → "2 canchas". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function upgrade(next: PlanDefinition | null): string {
  return next ? `pasate a ${next.name}: escribinos y lo cambiamos` : 'escribinos'
}

export function courtLimitMessage(plan: PlanDefinition, courts: number): string {
  return (
    `Tu plan ${plan.name} incluye hasta ${count(plan.courts ?? 0, 'cancha')} y ya tenés ${courts}. ` +
    `Para sumar otra, ${upgrade(nextPlanWithRoom(p => p.courts, courts))}.`
  )
}

export function userLimitMessage(plan: PlanDefinition, activeUsers: number): string {
  return (
    `Tu plan ${plan.name} incluye ${count(plan.users ?? 0, 'usuario')} activos, con vos incluido. ` +
    `Para sumar a alguien, desactivá a quien ya no use el panel o ` +
    `${upgrade(nextPlanWithRoom(p => p.users, activeUsers))}.`
  )
}

import { ClubSignupRequest } from 'generated/prisma/client'
import { answerLabel } from './signup-answers'

/** Cents → "$20.000" (the ops alert is read by a human, not parsed). */
function price(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('es-AR')}`
}

/**
 * The ops alert for a new lead. Written to be READ before picking up the phone: it opens
 * with who they are and how to reach them, then says how the setup will look (courts,
 * hours, prices, whether MercadoPago will be a fight) and what they're actually in pain
 * about. Anything they skipped is simply left out rather than printed as "—".
 */
export function formatSignupAlert(lead: ClubSignupRequest): string {
  const lines: string[] = [
    `🏓 *Nuevo club: ${lead.clubName}*${lead.city ? ` — ${lead.city}` : ''}`,
    `${lead.ownerName} · ${lead.phone} · ${lead.email}`,
  ]

  // A named window ("martes después de las 16") beats the generic bucket every time.
  const when = lead.contactWindowNote?.trim() || answerLabel(lead.contactWindow)
  if (when) lines.push(`📞 Prefiere que lo contacten ${when}.`)

  // How the complex is set up — this is what pre-loads the /setup wizard.
  const setup: string[] = []
  if (lead.courtCount) {
    const type = answerLabel(lead.courtType)
    setup.push(`${lead.courtCount} cancha${lead.courtCount === 1 ? '' : 's'}${type ? ` (${type})` : ''}`)
  }
  if (lead.slotDurationMinutes) setup.push(`turnos de ${lead.slotDurationMinutes} min`)
  if (lead.openTime && lead.closeTime) setup.push(`abre ${lead.openTime}–${lead.closeTime}`)
  if (lead.avgPriceCents) setup.push(`~${price(lead.avgPriceCents)} el turno`)
  if (setup.length) lines.push(`\n*Complejo:* ${setup.join(' · ')}`)

  // Payments — the step that decides how hard the provisioning call will be.
  const payments: string[] = []
  const deposit = answerLabel(lead.chargesDeposit)
  if (deposit) payments.push(deposit)
  if (lead.hasMercadoPago) {
    payments.push(`MercadoPago propio: ${answerLabel(lead.hasMercadoPago)}`)
  }
  if (payments.length) lines.push(`*Cobros:* ${payments.join(' · ')}`)

  // Context — what to lead the conversation with.
  const context: string[] = []
  const system = answerLabel(lead.currentSystem)
  if (system) context.push(`hoy gestiona con ${system}`)
  const pain = answerLabel(lead.biggestPain)
  if (pain) context.push(`le pesa ${pain}`)
  const fixed = answerLabel(lead.fixedSlots)
  if (fixed) context.push(`turnos fijos: ${fixed}`)
  if (context.length) lines.push(`*Contexto:* ${context.join(' · ')}`)

  const found = answerLabel(lead.howFound)
  if (found) lines.push(`_Nos conoció por ${found}._`)

  if (lead.message) lines.push(`\n💬 "${lead.message}"`)

  return lines.join('\n')
}

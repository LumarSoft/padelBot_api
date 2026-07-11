/**
 * The lead pipeline. Kept as strings (not a Prisma enum) for the same reason as the
 * signup answers: this is pre-sales state we want to reword without a migration.
 *
 * NEW → CONTACTED → CONVERTED, or LOST at any point. CONVERTED is set automatically when
 * the club is provisioned from the lead; it is not something we mark by hand.
 */
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'CONVERTED', 'LOST'] as const

export type LeadStatus = (typeof LEAD_STATUSES)[number]

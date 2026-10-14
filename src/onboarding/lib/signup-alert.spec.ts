import { ClubSignupRequest } from 'generated/prisma/client'
import { formatSignupAlert } from './signup-alert'

const lead = (over: Partial<ClubSignupRequest> = {}) =>
  ({
    clubName: 'Padel Norte',
    ownerName: 'Lucía',
    phone: '3415550000',
    email: 'lucia@padelnorte.com',
    city: 'Rosario',
    plan: null,
    ...over,
  }) as ClubSignupRequest

/** The plan they picked on the landing is the first thing ops needs before the call. */
describe('formatSignupAlert', () => {
  it('says which pricing card the lead came from', () => {
    expect(formatSignupAlert(lead({ plan: 'bandeja' }))).toContain('📦 Eligió el plan *Bandeja*.')
  })

  it('leaves the line out when they picked none (or an unknown key)', () => {
    expect(formatSignupAlert(lead())).not.toContain('Eligió el plan')
    expect(formatSignupAlert(lead({ plan: 'pro' }))).not.toContain('Eligió el plan')
  })
})

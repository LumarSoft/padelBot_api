import { ClubSignupRequest } from 'generated/prisma/client'
import { campaignLabel, formatSignupAlert } from './signup-alert'

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

describe('the campaign a lead came from', () => {
  it('names the UTM campaign, with its source and medium', () => {
    expect(campaignLabel({ utmSource: 'instagram', utmMedium: 'cpc', utmCampaign: 'verano' })).toBe(
      'verano (instagram / cpc)',
    )
    expect(campaignLabel({ utmSource: 'instagram', utmMedium: null, utmCampaign: null })).toBe('instagram')
    expect(campaignLabel({ utmSource: null, utmMedium: null, utmCampaign: null })).toBeNull()
  })
})

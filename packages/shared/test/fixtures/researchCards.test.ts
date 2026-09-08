import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import { ResearchCardSchema } from '../../src/contracts/research.js'
import {
  DISCOVERY_NOTE,
  RESEARCH_CARDS,
  RESEARCH_CURATED_ON,
  RESEARCH_NOTE,
} from '../../src/fixtures/researchCards.js'

const TEXT_FIELDS = ['title', 'authors', 'studyDesign', 'finding', 'limitation', 'relevance'] as const

describe('fixtures/researchCards', () => {
  it('exactly three cards with distinct ids', () => {
    expect(RESEARCH_CARDS).toHaveLength(3)
    expect(new Set(RESEARCH_CARDS.map((card) => card.id)).size).toBe(3)
  })

  it('each card passes ResearchCardSchema via Value.Check', () => {
    for (const card of RESEARCH_CARDS) {
      expect(Value.Check(ResearchCardSchema, card)).toBe(true)
    }
  })

  it('every sourceUrl starts with https://', () => {
    for (const card of RESEARCH_CARDS) {
      expect(card.sourceUrl.startsWith('https://')).toBe(true)
    }
  })

  it('every text field is non-empty and no finding contains "proves" or "causes"', () => {
    for (const card of RESEARCH_CARDS) {
      for (const field of TEXT_FIELDS) {
        expect(card[field].length).toBeGreaterThan(0)
      }
      expect(card.finding.toLowerCase()).not.toContain('proves')
      expect(card.finding.toLowerCase()).not.toContain('causes')
    }
  })

  it('curatedOn is 2026-09-06, every provenance.reviewed is "abstract", and the two note constants equal the research-cards spec copy verbatim', () => {
    expect(RESEARCH_CURATED_ON).toBe('2026-09-06')
    for (const card of RESEARCH_CARDS) {
      expect(card.curatedOn).toBe('2026-09-06')
      expect(card.provenance.reviewed).toBe('abstract')
    }
    expect(RESEARCH_NOTE).toBe('Up to three reviewed updates. Plan changes are your choice.')
    expect(DISCOVERY_NOTE).toBe('Automated discovery not enabled')
  })
})

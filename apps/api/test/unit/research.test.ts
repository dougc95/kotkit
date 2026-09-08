/**
 * `6.4.1` — pure-function unit tests: the `RESEARCH_CARDS` fixture's own
 * shape, and `registerResearchRoutes`'s sourceUrl guard (tested directly,
 * without booting a Fastify app — see routes/research.ts's header for why
 * it is a plain function rather than a `FastifyPluginAsync`). The
 * integration behavior of the registered route itself (response shape,
 * headers, byte-identical repeats) is covered by `test/research.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { RESEARCH_CARDS, type ResearchCardValue } from '@attention-lab/shared'

import { registerResearchRoutes } from '../../src/routes/research.js'

const PEER_REVIEW_STATES = ['peer_reviewed', 'preprint', 'unknown']
const REVIEW_DEPTHS = ['full_text', 'abstract']

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

describe('RESEARCH_CARDS fixture', () => {
  it('(1) has exactly 3 cards, every required field is a non-empty string or valid enum/int, and every sourceUrl matches ^https?://', () => {
    expect(RESEARCH_CARDS).toHaveLength(3)

    for (const card of RESEARCH_CARDS) {
      expect(isNonEmptyString(card.id)).toBe(true)
      expect(isNonEmptyString(card.title)).toBe(true)
      expect(isNonEmptyString(card.authors)).toBe(true)
      expect(Number.isInteger(card.year)).toBe(true)
      expect(isNonEmptyString(card.studyDesign)).toBe(true)
      expect(PEER_REVIEW_STATES).toContain(card.provenance.peerReview)
      expect(REVIEW_DEPTHS).toContain(card.provenance.reviewed)
      expect(isNonEmptyString(card.finding)).toBe(true)
      expect(isNonEmptyString(card.limitation)).toBe(true)
      expect(isNonEmptyString(card.relevance)).toBe(true)
      expect(card.sourceUrl).toMatch(/^https?:\/\//)
      expect(isNonEmptyString(card.curatedOn)).toBe(true)
    }
  })
})

describe('registerResearchRoutes', () => {
  it('(2) with a cards option containing a javascript: sourceUrl throws', () => {
    const fakeApp = { get: () => undefined } as unknown as FastifyInstance
    const [first, second, third] = RESEARCH_CARDS
    const badCards: ResearchCardValue[] = [
      first as ResearchCardValue,
      second as ResearchCardValue,
      { ...(third as ResearchCardValue), sourceUrl: 'javascript:alert(1)' },
    ]

    expect(() => registerResearchRoutes(fakeApp, { cards: badCards })).toThrow(
      /unsafe sourceUrl/,
    )
  })
})

/**
 * `GET /research/cards` — the three curated evidence cards (D13). A static
 * fixture, never a feed: exactly three cards, no pagination.
 *
 * See research-cards's "Three finite curated cards" and "Content is labeled
 * as demonstration content", and D40 (provenance recorded as
 * abstract-reviewed pending confirmation).
 */
import { Type, type Static } from '@sinclair/typebox'

import { Lit, LocalDateSchema, Obj } from './common.js'

const PEER_REVIEW_STATES = ['peer_reviewed', 'preprint', 'unknown'] as const
const REVIEW_DEPTHS = ['full_text', 'abstract'] as const

export const ResearchCardSchema = Obj({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  authors: Type.String({ minLength: 1 }),
  year: Type.Integer(),
  studyDesign: Type.String({ minLength: 1 }),
  provenance: Obj({
    peerReview: Lit(PEER_REVIEW_STATES),
    reviewed: Lit(REVIEW_DEPTHS),
  }),
  finding: Type.String({ minLength: 1 }),
  limitation: Type.String({ minLength: 1 }),
  relevance: Type.String({ minLength: 1 }),
  /** Deliberately a `pattern`, not `format: 'uuid'`-style strictness — see common.ts's UuidSchema note. */
  sourceUrl: Type.String({ pattern: '^https?://' }),
  curatedOn: LocalDateSchema,
})
export type ResearchCardValue = Static<typeof ResearchCardSchema>

/** Always exactly three cards (research-cards: "Three finite curated cards") — never a feed. */
export const ResearchCardsResponse = Obj({
  cards: Type.Array(ResearchCardSchema, { minItems: 3, maxItems: 3 }),
  curatedOn: LocalDateSchema,
  note: Type.String(),
  discoveryNote: Type.String(),
})
export type ResearchCardsResponseValue = Static<typeof ResearchCardsResponse>

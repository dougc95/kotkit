/**
 * The three curated research cards served by `GET /research/cards` (D13).
 * A static fixture, never a feed or a discovery table — see
 * research-cards's "Three finite curated cards" and "Content is labeled as
 * demonstration content".
 *
 * Content is drawn verbatim in substance (kept hedged, never strengthened)
 * from the protocol's evidence table and reference list in
 * `docs/Attention-Recovery-14-Day-Plan.md` (Castelo et al. 2025; Mrazek et
 * al. 2013; Leroy & Glomb 2018) — the three rows the PRD's Research screen
 * demonstrates. `provenance.reviewed` is `'abstract'` for all three per D40:
 * this bundle worked from indexed abstracts/publisher pages, not confirmed
 * full text, and that is recorded in LIMITATIONS.md as pending Douglas's
 * confirmation rather than asserted as full-text review.
 */
import type { ResearchCardValue } from '../contracts/research.js'

/** The date these three cards were curated (D13). */
export const RESEARCH_CURATED_ON = '2026-09-06'

/** Shown on the Research screen — research-cards: "Research screen opened". */
export const RESEARCH_NOTE = 'Up to three reviewed updates. Plan changes are your choice.'

/** Shown on the Research screen — research-cards: "Last-checked label". */
export const DISCOVERY_NOTE = 'Automated discovery not enabled'

/**
 * Exactly three curated cards (research-cards: "Three finite curated
 * cards"). Every finding stays hedged as in the protocol table: an
 * association or an improvement in a specific trial, never a proof or a
 * cause, and every limitation and relevance note names the gap between the
 * cited study and this experiment.
 */
export const RESEARCH_CARDS: ResearchCardValue[] = [
  {
    id: 'castelo-2025',
    title:
      'Blocking mobile internet on smartphones improves sustained attention, mental health, and subjective well-being',
    authors: 'Castelo et al.',
    year: 2025,
    studyDesign: 'randomized delayed-intervention trial, 467 participants enrolled',
    provenance: { peerReview: 'peer_reviewed', reviewed: 'abstract' },
    finding:
      'Blocking phone internet access for two weeks improved objectively measured sustained attention.',
    limitation:
      'Adherence and attrition limit interpretation, and the intervention was broader than stopping Reels alone: it blocked Wi-Fi and mobile data on the phone, while other-device internet and calls/texts remained available.',
    relevance:
      'Keeping the phone outside focus sessions is a practical adaptation, not a replication of the trial.',
    sourceUrl: 'https://academic.oup.com/pnasnexus/article/4/2/pgaf017/8016017',
    curatedOn: RESEARCH_CURATED_ON,
  },
  {
    id: 'mrazek-2013',
    title:
      'Mindfulness training improves working memory capacity and GRE performance while reducing mind wandering',
    authors: 'Mrazek et al.',
    year: 2013,
    studyDesign: 'randomized trial of 48 undergraduates',
    provenance: { peerReview: 'peer_reviewed', reviewed: 'abstract' },
    finding:
      'A two-week mindfulness course improved working memory and reading comprehension and reduced mind-wandering relative to nutrition instruction.',
    limitation:
      'The intervention was structured classroom instruction, not simply a few minutes using an app.',
    relevance:
      '5-10 minutes of daily practice here is used as an adjunct; this lighter routine is not the studied dose.',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/23538911/',
    curatedOn: RESEARCH_CURATED_ON,
  },
  {
    id: 'leroy-glomb-2018',
    title:
      'Tasks interrupted: How anticipating time pressure on resumption of an interrupted task causes attention residue and low performance on interrupting tasks and how a ready-to-resume plan mitigates the effects',
    authors: 'Leroy and Glomb',
    year: 2018,
    studyDesign: 'four studies',
    provenance: { peerReview: 'peer_reviewed', reviewed: 'abstract' },
    finding:
      'Brief ready-to-resume plans reduced attention residue and supported performance on an interrupting task.',
    limitation:
      'The original work did not directly establish improved performance after returning to the original, interrupted task.',
    relevance:
      'Leave a next-action note before switching; batched agent review is an application of this principle, not an AI-specific validated treatment.',
    sourceUrl: 'https://doi.org/10.1287/orsc.2017.1184',
    curatedOn: RESEARCH_CURATED_ON,
  },
]

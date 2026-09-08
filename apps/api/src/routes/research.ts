/**
 * `GET /research/cards` (task 6.4.1; design.md D13, D40, and the API
 * contracts table). Registered as a plain function — `registerResearchRoutes
 * (app, { cards = RESEARCH_CARDS })` — rather than the `FastifyPluginAsync`
 * shape every other route group uses, so its fixture-validation guard can be
 * unit-tested directly (no Fastify boot needed) and so the throw it raises
 * on a bad fixture surfaces synchronously at server-registration time
 * instead of inside a plugin's own async lifecycle.
 *
 * The three cards ship from `packages/shared/src/fixtures/researchCards.ts`
 * (D13: Castelo 2025, Mrazek 2013, Leroy & Glomb 2018) in the 2.7.5 contract
 * shape `ResearchCardsResponse`. No DB access, no pagination, no rotation
 * between calls — the same frozen `response` object is returned on every
 * request, so two consecutive GETs are byte-identical by construction.
 *
 * The route is the only one in this codebase declared `config: { public:
 * true } }` (apps/api/src/types/fastify.d.ts), which the 3.2.2 `noStore`
 * plugin reads to skip stamping `Cache-Control: no-store` — the cards are
 * demonstration content, not private measurement data.
 *
 * Provenance is recorded as abstract-reviewed (D40; see LIMITATIONS.md).
 */
import type { FastifyInstance } from 'fastify'
import {
  DISCOVERY_NOTE,
  RESEARCH_CARDS,
  RESEARCH_CURATED_ON,
  RESEARCH_NOTE,
  ResearchCardsResponse,
  type ResearchCardValue,
  type ResearchCardsResponseValue,
} from '@attention-lab/shared'

/** Deliberately loose (`http` too), matching `ResearchCardSchema.sourceUrl`'s own runtime pattern. */
const SOURCE_URL_PATTERN = /^https?:\/\//

export interface RegisterResearchRoutesOptions {
  cards?: ResearchCardValue[]
}

/**
 * The one fixture check this route makes at registration time: every card's
 * `sourceUrl` must actually be an `http(s)` link, never something like
 * `javascript:` that a naive "open deliberately" link could execute. A
 * failure here throws so the server never boots with a bad fixture — it is
 * never caught or downgraded to a log line.
 */
function assertSourceUrlsAreSafe(cards: readonly ResearchCardValue[]): void {
  for (const card of cards) {
    if (!SOURCE_URL_PATTERN.test(card.sourceUrl)) {
      throw new Error(
        `Research card '${card.id}' has an unsafe sourceUrl ('${card.sourceUrl}'); expected it to start with http:// or https://.`,
      )
    }
  }
}

export function registerResearchRoutes(
  app: FastifyInstance,
  options: RegisterResearchRoutesOptions = {},
): void {
  const cards = options.cards ?? RESEARCH_CARDS
  assertSourceUrlsAreSafe(cards)

  // Built once, at registration: every request returns this same frozen
  // object, so there is nothing per-request that could make two responses
  // diverge.
  const response: ResearchCardsResponseValue = Object.freeze({
    cards,
    curatedOn: RESEARCH_CURATED_ON,
    note: RESEARCH_NOTE,
    discoveryNote: DISCOVERY_NOTE,
  })

  app.get<{ Reply: ResearchCardsResponseValue }>(
    '/research/cards',
    {
      config: { public: true },
      schema: { response: { 200: ResearchCardsResponse } },
    },
    async () => response,
  )
}

export default registerResearchRoutes

/**
 * `6.4.1` — Fastify inject integration tests for `GET /research/cards`
 * against the real `attention_lab_test` database, via `buildTestApp`
 * (3.2.1). The route reads no row from the database; `buildTestApp` is used
 * anyway so the response passes through the exact same plugin pipeline
 * (requestId, noStore, errors, identity) every other route runs through.
 * Complements the pure-function unit tests in `test/unit/research.test.ts`
 * (the fixture's own shape, and `registerResearchRoutes`'s sourceUrl guard),
 * which this file never re-tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DISCOVERY_NOTE, RESEARCH_CURATED_ON, RESEARCH_NOTE } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from './helpers/buildTestApp.js'

interface ResearchCardBody {
  id: string
  title: string
  authors: string
  year: number
  studyDesign: string
  provenance: { peerReview: string; reviewed: string }
  finding: string
  limitation: string
  relevance: string
  sourceUrl: string
  curatedOn: string
}

interface ResearchCardsResponseBody {
  cards: ResearchCardBody[]
  curatedOn: string
  note: string
  discoveryNote: string
}

describe('GET /api/v1/research/cards (integration, attention_lab_test)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  afterAll(async () => {
    await testApp.close()
  })

  it('(1) 200 with exactly 3 cards, all required fields, curatedOn 2026-09-06, note and discoveryNote equal to the 2.8.3 constants', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/v1/research/cards' })
    expect(res.statusCode).toBe(200)

    const body = res.json() as ResearchCardsResponseBody
    expect(body.cards).toHaveLength(3)

    for (const card of body.cards) {
      expect(typeof card.id).toBe('string')
      expect(card.id.length).toBeGreaterThan(0)
      expect(typeof card.title).toBe('string')
      expect(card.title.length).toBeGreaterThan(0)
      expect(typeof card.authors).toBe('string')
      expect(card.authors.length).toBeGreaterThan(0)
      expect(Number.isInteger(card.year)).toBe(true)
      expect(typeof card.studyDesign).toBe('string')
      expect(card.studyDesign.length).toBeGreaterThan(0)
      expect(['peer_reviewed', 'preprint', 'unknown']).toContain(card.provenance.peerReview)
      expect(['full_text', 'abstract']).toContain(card.provenance.reviewed)
      expect(typeof card.finding).toBe('string')
      expect(card.finding.length).toBeGreaterThan(0)
      expect(typeof card.limitation).toBe('string')
      expect(card.limitation.length).toBeGreaterThan(0)
      expect(typeof card.relevance).toBe('string')
      expect(card.relevance.length).toBeGreaterThan(0)
      expect(card.sourceUrl).toMatch(/^https?:\/\//)
      expect(typeof card.curatedOn).toBe('string')
    }

    expect(body.curatedOn).toBe(RESEARCH_CURATED_ON)
    expect(body.note).toBe(RESEARCH_NOTE)
    expect(body.discoveryNote).toBe(DISCOVERY_NOTE)
  })

  it('(2) two consecutive GETs return byte-identical bodies', async () => {
    const first = await testApp.app.inject({ method: 'GET', url: '/api/v1/research/cards' })
    const second = await testApp.app.inject({ method: 'GET', url: '/api/v1/research/cards' })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.body).toBe(first.body)
  })

  it('(3) the response carries x-request-id and no Cache-Control: no-store (public route)', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/api/v1/research/cards' })

    expect(res.headers['x-request-id']).toBeTruthy()
    expect(res.headers['cache-control']).toBeUndefined()
  })
})

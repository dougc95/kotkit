import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'vitest'

import { DayResponse, FeedRowSchema, PutDayBody } from '../../src/contracts/days.js'
import { ExportQuery, ReportResponse } from '../../src/contracts/report.js'
import { ResearchCardSchema, ResearchCardsResponse } from '../../src/contracts/research.js'
import { feedAggregates } from '../../src/domain/feed.js'

const UUID_1 = '123e4567-e89b-12d3-a456-426614174000'
const UUID_2 = '123e4567-e89b-12d3-a456-426614174001'

describe('contracts/days', () => {
  it('FeedRow: minutes "30" rejected; shortVideoMinutes null accepted; platform "all" accepted and platform "" rejected (D36)', () => {
    const base = {
      device: 'phone',
      platform: 'all',
      minutes: 30,
      measurementScope: 'feed',
      source: 'estimate',
    }
    expect(Value.Check(FeedRowSchema, base)).toBe(true)
    expect(Value.Check(FeedRowSchema, { ...base, minutes: '30' })).toBe(false)
    expect(Value.Check(FeedRowSchema, { ...base, shortVideoMinutes: null })).toBe(true)
    expect(Value.Check(FeedRowSchema, { ...base, platform: '' })).toBe(false)
  })

  it('PutDayBody: stress 11 rejected, empty feed array accepted, sleepMinutes null accepted, expectedVersion 0 accepted', () => {
    const base = { expectedVersion: 0, feed: [] }
    expect(Value.Check(PutDayBody, base)).toBe(true)
    expect(Value.Check(PutDayBody, { ...base, stress: 11 })).toBe(false)
    expect(Value.Check(PutDayBody, { ...base, sleepMinutes: null })).toBe(true)
  })

  it('PutDayBody with short-video 45 on 30 minutes passes the schema (domain rule owned by feed.ts, not duplicated here)', () => {
    const body = {
      expectedVersion: 1,
      feed: [
        {
          device: 'phone',
          platform: 'all',
          minutes: 30,
          shortVideoMinutes: 45,
          measurementScope: 'feed',
          source: 'estimate',
        },
      ],
    }
    expect(Value.Check(PutDayBody, body)).toBe(true)
  })

  it('DayResponse: the D22 empty-day example (checkin all-null except localDate, feed [], status not_reported with missing [sleep, feed], all-null aggregates, version 0) validates', () => {
    const example = {
      checkin: {
        localDate: '2026-09-10',
        sleepMinutes: null,
        stress: null,
        mindfulnessMinutes: null,
        note: null,
      },
      feed: [],
      status: { status: 'not_reported', missing: ['sleep', 'feed'] },
      aggregates: feedAggregates([]),
      version: 0,
    }
    expect(Value.Check(DayResponse, example)).toBe(true)
  })

  it('ExportQuery format "json" rejected', () => {
    expect(Value.Check(ExportQuery, { format: 'csv' })).toBe(true)
    expect(Value.Check(ExportQuery, { format: 'markdown' })).toBe(true)
    expect(Value.Check(ExportQuery, { format: 'json' })).toBe(false)
  })

  it('ReportResponse resultState "success" rejected; days[] entry with status not_reported accepted; attempt with firstSwitch null and countMethod null accepted', () => {
    const example = {
      realm: 'demo',
      samples: { baselineEligible: 1, finalEligible: 0 },
      attempts: [
        {
          attemptId: UUID_1,
          phase: 'baseline',
          label: 'A',
          realm: 'demo',
          timeSource: 'demo_clock',
          eligible: false,
          exclusionReasons: ['count_unknown'],
          episodeCount: null,
          recallScore: null,
          firstSwitch: null,
          externalCount: null,
          unplannedAgentChecks: null,
          countMethod: null,
          conditions: {
            deviceFormat: null,
            language: null,
            materialLevel: null,
            accommodations: [],
          },
          localDate: '2026-09-06',
          lifecycle: 'finalized',
          replacementReason: null,
          recallFlags: [],
          revisionId: UUID_2,
          mindWanderingCount: null,
          materiallyDisrupted: null,
          timerQuality: 'uncertain',
          excludedByAmendment: false,
        },
      ],
      resultState: 'insufficient_samples',
      warnings: [],
      practice: [
        {
          sessionId: UUID_1,
          localDate: '2026-09-07',
          day: 1,
          targetSeconds: 600,
          completeInterval: true,
          outputQuality: 'yes',
          episodeCount: 0,
          externalCount: 0,
          unplannedAgentChecks: 0,
          revisionId: UUID_2,
        },
      ],
      days: [
        {
          localDate: '2026-09-09',
          day: 3,
          status: 'not_reported',
          sleepMinutes: null,
          stress: null,
          mindfulnessMinutes: null,
          feedDeviceMinutes: null,
          partial: true,
          feedByDevice: { phone: null, desktop: null, tablet: null, unspecified: null },
        },
      ],
      revisions: [
        {
          id: UUID_2,
          revision: 1,
          effectiveDay: 0,
          settings: {
            practiceTargetSeconds: 600,
            bandCeilings: [{ fromDay: 1, toDay: 3, minutes: 10 }],
            leisureAllowanceMin: 20,
          },
          reason: 'initial plan',
          createdAt: '2026-09-06T10:00:00Z',
        },
      ],
    }
    expect(Value.Check(ReportResponse, example)).toBe(true)
    expect(Value.Check(ReportResponse, { ...example, resultState: 'success' })).toBe(false)
  })
})

describe('contracts/research', () => {
  it('ResearchCard sourceUrl "ftp://x" rejected, https accepted', () => {
    const base = {
      id: 'castelo-2025',
      title: 'A title',
      authors: 'Castelo et al.',
      year: 2025,
      studyDesign: 'randomized delayed-intervention trial',
      provenance: { peerReview: 'peer_reviewed', reviewed: 'abstract' },
      finding: 'A finding',
      limitation: 'A limitation',
      relevance: 'A relevance note',
      sourceUrl: 'https://example.com/study',
      curatedOn: '2026-09-06',
    }
    expect(Value.Check(ResearchCardSchema, base)).toBe(true)
    expect(Value.Check(ResearchCardSchema, { ...base, sourceUrl: 'ftp://x' })).toBe(false)
  })

  it('ResearchCardsResponse with 2 or 4 cards rejected', () => {
    const card = {
      id: 'castelo-2025',
      title: 'A title',
      authors: 'Castelo et al.',
      year: 2025,
      studyDesign: 'randomized delayed-intervention trial',
      provenance: { peerReview: 'peer_reviewed', reviewed: 'abstract' },
      finding: 'A finding',
      limitation: 'A limitation',
      relevance: 'A relevance note',
      sourceUrl: 'https://example.com/study',
      curatedOn: '2026-09-06',
    }
    const base = {
      cards: [card, card, card],
      curatedOn: '2026-09-06',
      note: 'Up to three reviewed updates. Plan changes are your choice.',
      discoveryNote: 'Automated discovery not enabled',
    }
    expect(Value.Check(ResearchCardsResponse, base)).toBe(true)
    expect(Value.Check(ResearchCardsResponse, { ...base, cards: [card, card] })).toBe(false)
    expect(Value.Check(ResearchCardsResponse, { ...base, cards: [card, card, card, card] })).toBe(
      false,
    )
  })
})

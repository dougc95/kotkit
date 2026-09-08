/**
 * Task 6.3.1 — pure-function unit tests for `services/export/csv.ts`
 * (`buildCsv`, `csvField`, `csvRow`) plus the shared `services/export/
 * model.ts` first-switch cell derivation it renders through
 * (`exportFirstSwitchState`, `exportFirstSwitchSeconds`). No database —
 * every case is composed entirely from plain fixture `ExportModel` objects.
 */
import { describe, expect, it } from 'vitest'

import {
  buildCsv,
  csvField,
  csvRow,
  EXPORT_DEMO_LABEL,
} from '../../src/services/export/csv.js'
import {
  exportFirstSwitchSeconds,
  exportFirstSwitchState,
  type ExportAttemptRow,
  type ExportModel,
} from '../../src/services/export/model.js'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function baseAttempt(overrides: Partial<ExportAttemptRow> = {}): ExportAttemptRow {
  return {
    attemptId: 'attempt-1',
    phase: 'baseline',
    label: 'A',
    localDate: '2026-09-06',
    realm: 'demo',
    timeSource: 'measured',
    s: 4,
    sMethod: 'event',
    firstSwitch: { kind: 'known', seconds: 300 },
    firstSwitchMethod: 'event',
    recallScore: 4,
    e: 1,
    m: 0,
    disruption: false,
    deviceFormat: 'laptop',
    language: 'en',
    materialLevel: 'intermediate',
    accommodations: [],
    eligible: true,
    exclusionReasons: [],
    protocolRevision: 1,
    recallFlags: [],
    replacementReason: null,
    lifecycle: 'finalized',
    ...overrides,
  }
}

function baseModel(overrides: Partial<ExportModel> = {}): ExportModel {
  return {
    program: {
      programId: 'program-1',
      realm: 'demo',
      identityMode: 'local-demo',
      baselineDate: '2026-09-06',
      timezone: 'UTC',
      status: 'active',
      leisureAllowanceMin: 20,
      feedEstimateMin: null,
      exportedAt: '2026-09-20T00:00:00.000Z',
    },
    revisions: [],
    attempts: [baseAttempt()],
    days: [],
    feedRows: [],
    ...overrides,
  }
}

/** Splits the rendered CSV to just the `attempts` section's header + data lines. */
function attemptsLines(csv: string): string[] {
  const afterHeading = csv.split('# attempts\n')[1]
  if (afterHeading === undefined) throw new Error('attemptsLines: no "# attempts" section in CSV')
  return afterHeading.split('\n\n')[0]!.split('\n')
}

describe('services/export/csv: buildCsv and its cell rules (unit)', () => {
  it("null ReportedCount → empty cell and 0 → '0'", () => {
    const model = baseModel({
      attempts: [baseAttempt({ s: null, e: 0, m: null, recallScore: 0 })],
    })
    const [, dataLine] = attemptsLines(buildCsv(model))
    const cells = dataLine!.split(',')
    // header: attempt_id,phase,label,local_date,realm,time_source,s(6),
    // s_method,t_state,t_seconds,t_method,recall_score(11),e(12),m(13),...
    expect(cells[6]).toBe('') // s: null -> empty, never '0'
    expect(cells[11]).toBe('0') // recall_score: 0 -> '0', never blank
    expect(cells[12]).toBe('0') // e: 0 -> '0'
    expect(cells[13]).toBe('') // m: null -> empty
  })

  it("FirstSwitch none_capped → t_state '20+, capped'; known 370 → t_state 'known' with t_seconds 370; unknown → 'Unknown' (never '20+'); null → ''", () => {
    expect(exportFirstSwitchState({ kind: 'none_capped' })).toBe('20+, capped')
    expect(exportFirstSwitchSeconds({ kind: 'none_capped' })).toBeNull()

    expect(exportFirstSwitchState({ kind: 'known', seconds: 370 })).toBe('known')
    expect(exportFirstSwitchSeconds({ kind: 'known', seconds: 370 })).toBe(370)

    expect(exportFirstSwitchState({ kind: 'unknown' })).toBe('Unknown')
    expect(exportFirstSwitchState({ kind: 'unknown' })).not.toBe('20+, capped')
    expect(exportFirstSwitchSeconds({ kind: 'unknown' })).toBeNull()

    expect(exportFirstSwitchState(null)).toBe('')
    expect(exportFirstSwitchSeconds(null)).toBeNull()

    // And end to end, through the rendered attempts row (t_state at index 8, t_seconds at 9):
    const [, dataLine] = attemptsLines(
      buildCsv(baseModel({ attempts: [baseAttempt({ firstSwitch: { kind: 'known', seconds: 370 } })] })),
    )
    const cells = dataLine!.split(',')
    expect(cells[8]).toBe('known')
    expect(cells[9]).toBe('370')
  })

  it('fields containing commas, quotes or newlines are RFC 4180 quoted', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('a"b')).toBe('"a""b"')
    expect(csvField('a\nb')).toBe('"a\nb"')
    expect(csvRow(['a,b', 'plain', 'c"d'])).toBe('"a,b",plain,"c""d"')
  })

  it('demo realm prepends the label line; pilot realm does not', () => {
    const demoCsv = buildCsv(baseModel())
    expect(demoCsv.split('\n')[0]).toBe(`# ${EXPORT_DEMO_LABEL}`)

    const pilotModel = baseModel({
      program: { ...baseModel().program, realm: 'pilot' },
      attempts: [baseAttempt({ realm: 'pilot' })],
    })
    const pilotCsv = buildCsv(pilotModel)
    expect(pilotCsv.split('\n')[0]).toBe('# program')
    expect(pilotCsv).not.toContain(EXPORT_DEMO_LABEL)
  })

  it("attempt with episodeCount null and exclusionReasons ['count_unknown','recall_missing'] → s cell empty and exclusion_reasons cell 'count_unknown;recall_missing'", () => {
    const model = baseModel({
      attempts: [
        baseAttempt({
          s: null,
          eligible: false,
          exclusionReasons: ['count_unknown', 'recall_missing'],
        }),
      ],
    })
    const [, dataLine] = attemptsLines(buildCsv(model))
    const cells = dataLine!.split(',')
    expect(cells[6]).toBe('') // s
    expect(cells[20]).toBe('count_unknown;recall_missing') // exclusion_reasons
  })

  it('a model carrying note, output_note, disruption_note, recall points and review_note markers produces a CSV containing none of them', () => {
    const noisyModel = {
      ...baseModel(),
      program: { ...baseModel().program, note: 'FIXTURE_CHECKIN_NOTE_MARKER' },
      attempts: [
        {
          ...baseAttempt(),
          outputNote: 'FIXTURE_OUTPUT_NOTE_MARKER',
          disruptionNote: 'FIXTURE_DISRUPTION_NOTE_MARKER',
          recallPoints: ['FIXTURE_RECALL_POINT_MARKER'],
          reviewNote: 'FIXTURE_REVIEW_NOTE_MARKER',
          intendedOutput: 'FIXTURE_INTENDED_OUTPUT_MARKER',
        },
      ],
    } as unknown as ExportModel

    const csv = buildCsv(noisyModel)
    expect(csv).not.toContain('FIXTURE_CHECKIN_NOTE_MARKER')
    expect(csv).not.toContain('FIXTURE_OUTPUT_NOTE_MARKER')
    expect(csv).not.toContain('FIXTURE_DISRUPTION_NOTE_MARKER')
    expect(csv).not.toContain('FIXTURE_RECALL_POINT_MARKER')
    expect(csv).not.toContain('FIXTURE_REVIEW_NOTE_MARKER')
    expect(csv).not.toContain('FIXTURE_INTENDED_OUTPUT_MARKER')
  })
})

/**
 * Task 6.3.2 — pure-function unit tests for `services/export/markdown.ts`
 * (`buildMarkdown`, `mdCell`, `mdRow`) plus the shared `services/export/
 * model.ts` first-switch cell derivation it renders through
 * (`exportFirstSwitchState`). No database — every case is composed entirely
 * from plain fixture `ExportModel` objects.
 */
import { describe, expect, it } from 'vitest'

import { buildMarkdown, mdCell, mdRow } from '../../src/services/export/markdown.js'
import { EXPORT_DEMO_LABEL } from '../../src/services/export/csv.js'
import type { ExportAttemptRow, ExportModel } from '../../src/services/export/model.js'

// ---------------------------------------------------------------------------
// Fixture builders (mirrors test/unit/export.csv.test.ts's fixtures so the
// two suites exercise the same shapes through each renderer)
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

/** The `## Attempts` section's body — up to (not including) the next `## ` heading. */
function attemptsSection(md: string): string {
  const afterHeading = md.split('## Attempts\n\n')[1]
  if (afterHeading === undefined) throw new Error('attemptsSection: no "## Attempts" section in Markdown')
  return afterHeading.split('\n\n## ')[0]!
}

/** Just the attempts table's data rows (header and `---` divider stripped), one string per attempt. */
function attemptsDataRows(md: string): string[] {
  const lines = attemptsSection(md)
    .split('\n')
    .filter((line) => line.startsWith('|'))
  return lines.slice(2) // 0: header row, 1: divider row
}

describe('services/export/markdown: buildMarkdown and its cell rules (unit)', () => {
  it('pipe characters in cells are escaped', () => {
    expect(mdCell('plain')).toBe('plain')
    expect(mdCell('a|b')).toBe('a\\|b')
    expect(mdRow(['a|b', 'plain'])).toBe('| a\\|b | plain |')

    const model = baseModel({
      revisions: [
        {
          revision: 1,
          effectiveDay: 0,
          practiceTargetSeconds: 600,
          bandCeilings: [],
          leisureAllowanceMin: 20,
          reason: 'plan A | plan B',
          createdAt: '2026-09-06T00:00:00.000Z',
        },
      ],
    })
    const md = buildMarkdown(model)
    expect(md).toContain('plan A \\| plan B')
  })

  it('null ReportedCount → empty cell', () => {
    const model = baseModel({
      attempts: [baseAttempt({ s: null, e: 0, m: null, recallScore: 0 })],
    })
    const [dataLine] = attemptsDataRows(buildMarkdown(model))
    const cells = dataLine!.split(' | ')
    // header: | attempt_id | phase | label | local_date | realm | time_source | s(6) | s_method | ...
    expect(cells[6]).toBe('') // s: null -> empty, never '0'
    expect(cells[11]).toBe('0') // recall_score: 0 -> '0', never blank
  })

  it("t_state '20+, capped' stays visible in the attempts table", () => {
    const model = baseModel({
      attempts: [baseAttempt({ firstSwitch: { kind: 'none_capped' } })],
    })
    const section = attemptsSection(buildMarkdown(model))
    expect(section).toContain('20+, capped')
  })

  it('demo realm → first line is the demo label', () => {
    const md = buildMarkdown(baseModel())
    expect(md.split('\n')[0]).toBe(`# ${EXPORT_DEMO_LABEL}`)

    const pilotMd = buildMarkdown(
      baseModel({
        program: { ...baseModel().program, realm: 'pilot' },
        attempts: [baseAttempt({ realm: 'pilot' })],
      }),
    )
    expect(pilotMd.split('\n')[0]).toBe('# Attention Lab program record')
    expect(pilotMd).not.toContain(EXPORT_DEMO_LABEL)
  })

  it('a model carrying free-text markers produces Markdown containing none of them', () => {
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

    const md = buildMarkdown(noisyModel)
    expect(md).not.toContain('FIXTURE_CHECKIN_NOTE_MARKER')
    expect(md).not.toContain('FIXTURE_OUTPUT_NOTE_MARKER')
    expect(md).not.toContain('FIXTURE_DISRUPTION_NOTE_MARKER')
    expect(md).not.toContain('FIXTURE_RECALL_POINT_MARKER')
    expect(md).not.toContain('FIXTURE_REVIEW_NOTE_MARKER')
    expect(md).not.toContain('FIXTURE_INTENDED_OUTPUT_MARKER')
  })
})

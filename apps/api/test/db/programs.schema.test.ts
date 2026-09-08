/**
 * 3.3.1 — schema tests for user_profiles, programs, protocol_revisions and
 * benchmark_slots.
 *
 * Uses its own profile id `schema-test-user` (never `local-demo`) so these
 * tests stay independent of the principal seeding 3.2.3 adds later
 * (design.md 3.3.1 task brief).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { StringChunk, type SQL } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { DEFAULT_BAND_CEILINGS, type BenchmarkPhase, type ProgramStatus, type SlotLabel } from '@attention-lab/shared'

import { buildTestApp, type TestApp } from '../helpers/buildTestApp.js'
import {
  userProfiles,
  programs,
  protocolRevisions,
  benchmarkSlots,
} from '../../src/db/schema/index.js'
import { DEFAULT_PREFERENCES } from '../../src/preferences.js'

const PROFILE_ID = 'schema-test-user'

/** Flattens a `where` clause's query chunks back to plain text for assertion. */
function whereText(clause: SQL | undefined): string {
  if (!clause) return ''
  return clause.queryChunks
    .map((chunk) => (chunk instanceof StringChunk ? chunk.value.join(' ') : ''))
    .join(' ')
}

function programValues(status: ProgramStatus = 'draft') {
  return {
    userId: PROFILE_ID,
    realm: 'demo' as const,
    baselineDate: '2026-09-06',
    timezone: 'UTC',
    status,
    leisureAllowanceMin: 20,
  }
}

function revisionValues(programId: string, revision: number) {
  return {
    programId,
    revision,
    effectiveDay: 0,
    settings: {
      practiceTargetSeconds: 600,
      bandCeilings: DEFAULT_BAND_CEILINGS,
      leisureAllowanceMin: 20,
    },
    reason: 'initial plan',
  }
}

function slotValues(programId: string, phase: BenchmarkPhase, label: SlotLabel) {
  return {
    programId,
    phase,
    label,
    materialRef: 'Chapter 3',
    assignedLocalDate: '2026-09-06',
  }
}

describe('programs schema (unit, getTableConfig, no DB)', () => {
  it('(1) programs has a partial unique index programs_one_open_per_user whose where mentions draft, baseline_ready and active', () => {
    const config = getTableConfig(programs)
    const index = config.indexes.find((i) => i.config.name === 'programs_one_open_per_user')
    expect(index).toBeDefined()
    expect(index?.config.unique).toBe(true)
    const columns = index?.config.columns.map((c) => (c as { name?: string }).name)
    expect(columns).toEqual(['user_id'])
    const text = whereText(index?.config.where)
    expect(text).toContain('draft')
    expect(text).toContain('baseline_ready')
    expect(text).toContain('active')
  })

  it('(2) programs.feed_estimate_min is nullable with no default', () => {
    const column = getTableConfig(programs).columns.find((c) => c.name === 'feed_estimate_min')
    expect(column).toBeDefined()
    expect(column?.notNull).toBe(false)
    expect(column?.hasDefault).toBe(false)
  })

  it('(3) programs.realm is NOT NULL and has no default', () => {
    const column = getTableConfig(programs).columns.find((c) => c.name === 'realm')
    expect(column).toBeDefined()
    expect(column?.notNull).toBe(true)
    expect(column?.hasDefault).toBe(false)
  })

  it('(4) protocol_revisions is unique on (program_id, revision)', () => {
    const config = getTableConfig(protocolRevisions)
    const unique = config.uniqueConstraints.find(
      (u) => u.columns.map((c) => c.name).sort().join(',') === 'program_id,revision',
    )
    expect(unique).toBeDefined()
  })

  it('(5) benchmark_slots is unique on (program_id, phase, label)', () => {
    const config = getTableConfig(benchmarkSlots)
    const unique = config.uniqueConstraints.find(
      (u) => u.columns.map((c) => c.name).sort().join(',') === 'label,phase,program_id',
    )
    expect(unique).toBeDefined()
  })
})

describe('programs schema (integration, attention_lab_test)', () => {
  let testApp: TestApp

  beforeAll(async () => {
    testApp = await buildTestApp()
  })

  afterAll(async () => {
    await testApp.close()
  })

  beforeEach(async () => {
    await testApp.truncateAll()
  })

  async function insertProfile(): Promise<void> {
    await testApp.db.insert(userProfiles).values({
      id: PROFILE_ID,
      timezone: 'UTC',
      preferences: DEFAULT_PREFERENCES,
    })
  }

  it('(6) inserts profile schema-test-user then a draft program', async () => {
    await insertProfile()
    const [program] = await testApp.db.insert(programs).values(programValues('draft')).returning()
    expect(program?.status).toBe('draft')
    expect(program?.realm).toBe('demo')
  })

  it('(7) a second open program for the same user violates programs_one_open_per_user (23505)', async () => {
    await insertProfile()
    await testApp.db.insert(programs).values(programValues('draft'))
    await expect(
      testApp.db.insert(programs).values(programValues('active')),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'programs_one_open_per_user' },
    })
  })

  it('(8) a second program with status completed is allowed alongside an open one', async () => {
    await insertProfile()
    await testApp.db.insert(programs).values(programValues('draft'))
    const [second] = await testApp.db
      .insert(programs)
      .values(programValues('completed'))
      .returning()
    expect(second?.status).toBe('completed')
  })

  it('(9) a program inserted without realm is rejected 23502; no default leaks', async () => {
    await insertProfile()
    await expect(
      testApp.sql`insert into programs (user_id, baseline_date, timezone, status, leisure_allowance_min)
                  values (${PROFILE_ID}, '2026-09-06', 'UTC', 'draft', 20)`,
    ).rejects.toMatchObject({ code: '23502' })
  })

  it('(10) two protocol_revisions rows with the same (program_id, revision) violate the unique constraint (23505)', async () => {
    await insertProfile()
    const [program] = await testApp.db.insert(programs).values(programValues('draft')).returning()
    await testApp.db.insert(protocolRevisions).values(revisionValues(program!.id, 1))
    await expect(
      testApp.db.insert(protocolRevisions).values(revisionValues(program!.id, 1)),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'protocol_revisions_program_revision_unique' },
    })
  })

  it('(11) two benchmark_slots rows for (baseline, A) violate the unique constraint (23505)', async () => {
    await insertProfile()
    const [program] = await testApp.db.insert(programs).values(programValues('draft')).returning()
    await testApp.db.insert(benchmarkSlots).values(slotValues(program!.id, 'baseline', 'A'))
    await expect(
      testApp.db.insert(benchmarkSlots).values(slotValues(program!.id, 'baseline', 'A')),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint_name: 'benchmark_slots_program_phase_label_unique' },
    })
  })

  it('(12) (baseline, A) and (final, A) for the same program are both allowed', async () => {
    await insertProfile()
    const [program] = await testApp.db.insert(programs).values(programValues('draft')).returning()
    await testApp.db.insert(benchmarkSlots).values(slotValues(program!.id, 'baseline', 'A'))
    const [final] = await testApp.db
      .insert(benchmarkSlots)
      .values(slotValues(program!.id, 'final', 'A'))
      .returning()
    expect(final?.phase).toBe('final')
  })

  it('(13) a program inserted with feed_estimate_min omitted reads back null, never 0', async () => {
    await insertProfile()
    const [program] = await testApp.db.insert(programs).values(programValues('draft')).returning()
    expect(program?.feedEstimateMin).toBeNull()
  })
})

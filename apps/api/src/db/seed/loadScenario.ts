/**
 * `loadScenario` (3.5.4; design.md D34, D35, API contracts
 * `POST /demo/scenarios/{name}/load`): replaces the principal's demo data
 * with one named fixture from `packages/shared/src/fixtures/demoScenarios.ts`
 * (2.8.1/2.8.2).
 *
 * `deletePrincipalData` (3.5.3) runs first — this is what actually resets the
 * demo clock offset to 0 (D35's "loading resets the demo clock to 0"); the
 * loader itself never writes `user_profiles`.
 *
 * D35 governs every date/instant this file produces:
 *  - `loadInstant` is REAL now, not `ctx.now` — by the time this runs,
 *    `deletePrincipalData` has already zeroed the stored offset, but
 *    `ctx.now` was captured by the identity plugin at the START of this
 *    request, before that reset, so it can still carry a stale nonzero
 *    offset. Reconstructing real time as `ctx.now - offsetSeconds` (rather
 *    than reading a fresh `new Date()`) keeps every date in this load
 *    anchored to the exact instant the request context was built.
 *  - `anchorScenario` (packages/shared) turns the fixture's day numbers and
 *    relative-second offsets into real dates/instants around that
 *    `loadInstant`; this file inserts exactly what comes back from it,
 *    inventing no date of its own.
 *
 * D34: `programs`, `focus_sessions` and `daily_checkins` are the three realm
 * roots — each is stamped with `ownerStamp(ctx)` (`{ userId, realm }`,
 * `plugins/identity.ts`), which is always `{ 'local-demo', 'demo' }` in this
 * mode. Every other table inherits ownership through its parent and carries
 * neither column. `assertDemoRealm` is the one guard every root row's own
 * `realm` field is checked against before it is trusted: a fixture that ever
 * carried `'pilot'` is a fixture BUG, and this throws rather than silently
 * rewriting or dropping the row.
 *
 * Every `ReportedCount` field (`episodeCount`, `externalCount`,
 * `unplannedAgentChecks`, `mindWanderingCount`, `recallScore`,
 * `clockGapSeconds`, `feedEstimateMinutes`, `sleepMinutes`, `stress`,
 * `mindfulnessMinutes`) is passed straight through from the anchored fixture
 * row to the insert — `null` stays `null`, `0` stays `0`; nothing in this
 * file ever coalesces one into the other (HANDOFF.md "Unknown does not equal
 * zero").
 *
 * Fixture-local ids (`slotKey`, `sessionKey`, a fixture's own
 * `clientEventId` strings such as `'td-clock-gap-1'`, which are never
 * themselves valid UUIDs) are never written to the database — every row's
 * real primary key is minted fresh by Postgres (`defaultRandom()`) or, for
 * `session_events.client_event_id` (which has no default), by `randomUUID()`
 * here. Fixture keys exist only to correlate rows with each other while this
 * function runs, in `slotIdByKey` / `sessionIdByKey` / `checkinIdByLocalDate`.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type {
  AnchoredReview,
  CountMethod,
  DemoScenario,
  FirstSwitchKind,
  FirstSwitchMethod,
  ObservedConditions,
  OutputQuality,
  Realm,
  RecallFlag,
  RecallPoints,
  RecallScoreValue,
  ReportedCount,
} from '@attention-lab/shared'
import { anchorScenario } from '@attention-lab/shared'
import type { AppTransaction } from '../../idempotency/withIdempotency.js'
import type { RequestContext } from '../../plugins/identity.js'
import { ownerStamp } from '../../plugins/identity.js'
import { programs } from '../schema/programs.js'
import { protocolRevisions } from '../schema/protocolRevisions.js'
import { benchmarkSlots } from '../schema/benchmarkSlots.js'
import { focusSessions } from '../schema/focusSessions.js'
import { sessionEvents } from '../schema/sessionEvents.js'
import { sessionReviews } from '../schema/sessionReviews.js'
import { sessionAmendments } from '../schema/sessionAmendments.js'
import { agentPlans } from '../schema/agentPlans.js'
import { dailyCheckins } from '../schema/dailyCheckins.js'
import { feedUsage } from '../schema/feedUsage.js'
import { deletePrincipalData } from './deletePrincipalData.js'

export interface LoadScenarioResult {
  readonly programId: string | null
}

/**
 * Throws when a fixture root row's own `realm` field is anything other than
 * `'demo'` — a fixture bug (2.8.x is meant to author demo-only rows) is never
 * silently rewritten or dropped. Exported so it is unit-testable in
 * isolation from the database (`demoScenarios.test.ts` unit case 2).
 */
export function assertDemoRealm(realm: Realm, description: string): asserts realm is 'demo' {
  if (realm !== 'demo') {
    throw new Error(
      `loadScenario: fixture ${description} carries realm "${realm}", expected "demo" — ` +
        'a fixture bug is never silently rewritten.',
    )
  }
}

/** The one `session_reviews` insert shape, built straight from an anchored review row. */
export interface ReviewInsertValues {
  readonly sessionId: string
  readonly episodeCount: ReportedCount
  readonly countMethod: CountMethod | null
  readonly firstSwitchKind: FirstSwitchKind | null
  readonly firstSwitchSeconds: number | null
  readonly firstSwitchMethod: FirstSwitchMethod | null
  readonly externalCount: ReportedCount
  readonly unplannedAgentChecks: ReportedCount
  readonly mindWanderingCount: ReportedCount
  readonly outputQuality: OutputQuality | null
  readonly outputNote: string | null
  readonly reviewNote: string | null
  readonly materiallyDisrupted: boolean | null
  readonly disruptionNote: string | null
  readonly recallPoints: RecallPoints | null
  readonly recallStartedAt: Date | null
  readonly recallLockedAt: Date | null
  readonly recallDelaySeconds: number | null
  readonly recallDurationSeconds: number | null
  readonly recallFlags: RecallFlag[]
  readonly recallScores: readonly RecallScoreValue[] | null
  readonly recallScore: ReportedCount
  // Mutable, unlike the domain `ObservedConditions` type's `readonly
  // accommodations` — this is what the jsonb column's insert type expects;
  // `toReviewInsertValues` below copies the fixture's readonly array into a
  // fresh mutable one rather than widening the domain type itself.
  readonly observedConditions: {
    deviceFormat: string | null
    language: string | null
    materialLevel: string | null
    accommodations: ObservedConditions['accommodations'][number][]
  }
  readonly finalizedAt: Date | null
}

/**
 * Pure mapper from one anchored `session_reviews` row to its insert values.
 * Every `ReportedCount` field (`episodeCount`, `externalCount`,
 * `unplannedAgentChecks`, `mindWanderingCount`, `recallScore`) is passed
 * through unchanged — `null` stays `null`, `0` stays `0` (unit test 3).
 */
export function toReviewInsertValues(review: AnchoredReview, sessionId: string): ReviewInsertValues {
  return {
    sessionId,
    episodeCount: review.episodeCount,
    countMethod: review.countMethod,
    firstSwitchKind: review.firstSwitchKind,
    firstSwitchSeconds: review.firstSwitchSeconds,
    firstSwitchMethod: review.firstSwitchMethod,
    externalCount: review.externalCount,
    unplannedAgentChecks: review.unplannedAgentChecks,
    mindWanderingCount: review.mindWanderingCount,
    outputQuality: review.outputQuality,
    outputNote: review.outputNote,
    reviewNote: review.reviewNote,
    materiallyDisrupted: review.materiallyDisrupted,
    disruptionNote: review.disruptionNote,
    recallPoints: review.recallPoints,
    recallStartedAt: review.recallStartedAt === null ? null : new Date(review.recallStartedAt),
    recallLockedAt: review.recallLockedAt === null ? null : new Date(review.recallLockedAt),
    recallDelaySeconds: review.recallDelaySeconds,
    recallDurationSeconds: review.recallDurationSeconds,
    recallFlags: [...review.recallFlags],
    recallScores: review.recallScores,
    recallScore: review.recallScore,
    observedConditions: { ...review.observedConditions, accommodations: [...review.observedConditions.accommodations] },
    finalizedAt: review.finalizedAt === null ? null : new Date(review.finalizedAt),
  }
}

/** One inserted `protocol_revisions` row, reduced to what governing-revision lookup needs. */
interface InsertedRevision {
  readonly id: string
  readonly revision: number
  readonly effectiveDay: number
}

/**
 * D33's governing-revision rule, applied to this program's own inserted
 * revisions: the revision with the greatest `effectiveDay <= max(day, 0)`,
 * ties broken by the highest revision number. Days before Day 0 are governed
 * by revision 1, matching 4.1.1's `governingRevisionFor` (not yet
 * implemented — group 4 — so this is a local, deliberately identical rule
 * rather than a shared import).
 */
function governingRevisionId(revisions: readonly InsertedRevision[], day: number): string {
  const clampedDay = Math.max(day, 0)
  let best: InsertedRevision | null = null
  for (const revision of revisions) {
    if (revision.effectiveDay > clampedDay) continue
    if (
      best === null ||
      revision.effectiveDay > best.effectiveDay ||
      (revision.effectiveDay === best.effectiveDay && revision.revision > best.revision)
    ) {
      best = revision
    }
  }
  if (best === null) {
    throw new Error(`loadScenario: no protocol revision governs day ${day}`)
  }
  return best.id
}

/**
 * Deletes every row this principal owns (3.5.3, which also zeroes the demo
 * clock offset) and, unless the scenario is the programless `new-user`
 * fixture, inserts one full scenario's row set in FK order: program ->
 * revisions (then `current_revision_id` set to the newest) -> slots ->
 * sessions -> events / reviews / amendments / agent plans -> check-ins ->
 * feed rows. Returns the new program's id, or `null` for `new-user`.
 */
export async function loadScenario(
  tx: AppTransaction,
  ctx: RequestContext,
  scenario: DemoScenario,
): Promise<LoadScenarioResult> {
  await deletePrincipalData(tx, ctx)

  if (scenario.program === null) {
    return { programId: null }
  }
  assertDemoRealm(scenario.program.realm, `program (scenario "${scenario.name}")`)

  // D35: real "now", independent of the (already-zeroed) demo clock offset —
  // see the module docstring for why this is not simply `new Date()`.
  const loadInstant = new Date(ctx.now.getTime() - ctx.demoClockOffsetSeconds * 1000)
  const anchored = anchorScenario(scenario, loadInstant)
  const program = anchored.program!

  const stamp = ownerStamp(ctx)

  const [programRow] = await tx
    .insert(programs)
    .values({
      ...stamp,
      baselineDate: anchored.baselineDate,
      timezone: program.timezone,
      status: program.status,
      leisureAllowanceMin: program.leisureAllowanceMinutes,
      feedEstimateMin: program.feedEstimateMinutes,
    })
    .returning({ id: programs.id })
  const programId = programRow!.id

  const insertedRevisions: InsertedRevision[] = []
  for (const revision of anchored.revisions) {
    const [row] = await tx
      .insert(protocolRevisions)
      .values({
        programId,
        revision: revision.revision,
        effectiveDay: revision.effectiveDay,
        settings: {
          practiceTargetSeconds: revision.practiceTargetSeconds,
          bandCeilings: revision.bandCeilings,
          leisureAllowanceMin: revision.leisureAllowanceMin,
        },
        reason: revision.reason,
      })
      .returning({ id: protocolRevisions.id })
    insertedRevisions.push({ id: row!.id, revision: revision.revision, effectiveDay: revision.effectiveDay })
  }
  if (insertedRevisions.length === 0) {
    throw new Error(`loadScenario: scenario "${scenario.name}" has a program but no revisions`)
  }

  // D33: current_revision_id is always the newest (highest-numbered) revision.
  const newestRevision = insertedRevisions.reduce((newest, candidate) =>
    candidate.revision > newest.revision ? candidate : newest,
  )
  await tx
    .update(programs)
    .set({ currentRevisionId: newestRevision.id })
    .where(eq(programs.id, programId))

  const slotIdByKey = new Map<string, string>()
  for (const slot of anchored.slots) {
    const [row] = await tx
      .insert(benchmarkSlots)
      .values({
        programId,
        phase: slot.phase,
        label: slot.label,
        materialRef: slot.materialRef,
        language: slot.language,
        deviceFormat: slot.deviceFormat,
        materialLevel: slot.materialLevel,
        plannedLocalTime: slot.plannedLocalTime,
        assignedLocalDate: slot.assignedLocalDate,
      })
      .returning({ id: benchmarkSlots.id })
    slotIdByKey.set(slot.slotKey, row!.id)
  }

  const sessionIdByKey = new Map<string, string>()
  for (let i = 0; i < scenario.sessions.length; i++) {
    const rawSession = scenario.sessions[i]!
    const anchoredSession = anchored.sessions[i]!
    assertDemoRealm(anchoredSession.realm, `session "${anchoredSession.sessionKey}"`)

    let slotId: string | null = null
    if (anchoredSession.slotKey !== undefined) {
      const found = slotIdByKey.get(anchoredSession.slotKey)
      if (found === undefined) {
        throw new Error(
          `loadScenario: no slot "${anchoredSession.slotKey}" for session "${anchoredSession.sessionKey}"`,
        )
      }
      slotId = found
    }

    const revisionId = governingRevisionId(insertedRevisions, rawSession.localDay)

    const [row] = await tx
      .insert(focusSessions)
      .values({
        ...stamp,
        programId,
        revisionId,
        slotId,
        kind: anchoredSession.kind,
        lifecycle: anchoredSession.lifecycle,
        targetSeconds: anchoredSession.targetSeconds,
        startedAt: new Date(anchoredSession.startedAt),
        endedAt: anchoredSession.endedAt === null ? null : new Date(anchoredSession.endedAt),
        pausedSeconds: anchoredSession.pausedSeconds,
        localDate: anchoredSession.localDate,
        intendedOutput: anchoredSession.intendedOutput,
        // D34: every fixture-loaded session used simulated time, regardless
        // of what any individual fixture row happens to carry.
        timeSource: 'demo_clock',
        timerQuality: anchoredSession.timerQuality,
        clockGapSeconds: anchoredSession.clockGapSeconds,
        completeInterval: anchoredSession.completeInterval,
        eligible: anchoredSession.eligible,
        exclusionReasons: [...anchoredSession.exclusionReasons],
        replacementReason: anchoredSession.replacementReason,
      })
      .returning({ id: focusSessions.id })
    sessionIdByKey.set(anchoredSession.sessionKey, row!.id)
  }

  for (let i = 0; i < scenario.events.length; i++) {
    const anchoredEvent = anchored.events[i]!
    const sessionId = sessionIdByKey.get(anchoredEvent.sessionKey)
    if (sessionId === undefined) {
      throw new Error(`loadScenario: no session "${anchoredEvent.sessionKey}" for event`)
    }
    const occurredAt = new Date(anchoredEvent.occurredAt)
    await tx.insert(sessionEvents).values({
      sessionId,
      // Fixture-local clientEventId strings (e.g. 'td-clock-gap-1') are never
      // themselves valid UUIDs; every load mints a fresh one.
      clientEventId: randomUUID(),
      type: anchoredEvent.type,
      occurredAt,
      elapsedMs: anchoredEvent.elapsedMs,
      details: anchoredEvent.details ?? {},
      voidedAt: anchoredEvent.voided === true ? occurredAt : null,
    })
  }

  for (let i = 0; i < scenario.reviews.length; i++) {
    const anchoredReview = anchored.reviews[i]!
    const sessionId = sessionIdByKey.get(anchoredReview.sessionKey)
    if (sessionId === undefined) {
      throw new Error(`loadScenario: no session "${anchoredReview.sessionKey}" for review`)
    }
    await tx.insert(sessionReviews).values(toReviewInsertValues(anchoredReview, sessionId))
  }

  for (let i = 0; i < scenario.amendments.length; i++) {
    const anchoredAmendment = anchored.amendments[i]!
    const sessionId = sessionIdByKey.get(anchoredAmendment.sessionKey)
    if (sessionId === undefined) {
      throw new Error(`loadScenario: no session "${anchoredAmendment.sessionKey}" for amendment`)
    }
    await tx.insert(sessionAmendments).values({
      sessionId,
      userId: ctx.principalId,
      reason: anchoredAmendment.reason,
      excludeFromReport: anchoredAmendment.excludeFromReport,
      createdAt: new Date(anchoredAmendment.createdAt),
    })
  }

  for (const plan of scenario.agentPlans) {
    const sessionId = sessionIdByKey.get(plan.sessionKey)
    if (sessionId === undefined) {
      throw new Error(`loadScenario: no session "${plan.sessionKey}" for agent plan`)
    }
    await tx.insert(agentPlans).values({
      sessionId,
      workstream: plan.workstream,
      waitingTask: plan.waitingTask,
      resumeNote: plan.resumeNote,
      reviewCheckpoint: plan.reviewCheckpoint ?? 'end_of_block',
    })
  }

  const checkinIdByLocalDate = new Map<string, string>()
  for (const checkin of anchored.checkins) {
    assertDemoRealm(checkin.realm, `check-in "${checkin.localDate}"`)
    const [row] = await tx
      .insert(dailyCheckins)
      .values({
        programId,
        realm: 'demo',
        localDate: checkin.localDate,
        sleepMinutes: checkin.sleepMinutes,
        stress: checkin.stress,
        mindfulnessMinutes: checkin.mindfulnessMinutes,
        note: checkin.note,
      })
      .returning({ id: dailyCheckins.id })
    checkinIdByLocalDate.set(checkin.localDate, row!.id)
  }

  for (const feedRow of anchored.feedRows) {
    const checkinId = checkinIdByLocalDate.get(feedRow.localDate)
    if (checkinId === undefined) {
      throw new Error(`loadScenario: no check-in "${feedRow.localDate}" for feed row`)
    }
    await tx.insert(feedUsage).values({
      checkinId,
      device: feedRow.device,
      platform: feedRow.platform,
      minutes: feedRow.minutes,
      shortVideoMinutes: feedRow.shortVideoMinutes,
      measurementScope: feedRow.measurementScope,
      source: feedRow.source,
      plannedWindow: feedRow.plannedWindow,
    })
  }

  return { programId }
}

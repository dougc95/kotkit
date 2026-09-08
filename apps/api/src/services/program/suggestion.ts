/**
 * Task 4.5.1 — the progression-suggestion adapter over stored `focus_sessions`
 * rows (joined to `session_reviews`). Pure: no database import, no route
 * registration. `getToday` (4.5.3) loads Days 1..day-1 of a program's
 * practice and benchmark sessions, passes them through `toPracticeBlockRecords`
 * / `deriveSuggestion` here, and returns the result as `TodayResponse.suggestion`.
 *
 * This module does not reimplement the qualification rule — that is
 * `suggestProgression` in `packages/shared/src/domain/progression.ts` (2.5.2).
 * It only adapts raw stored rows into that function's `PracticeBlockRecord`
 * input, mirroring the same "first two candidates by startedAt, per local
 * date" rule 4.2.1's `deriveBlocks` already uses for Today's blocks, so a
 * third practice session on a qualifying day can never smuggle in an extra
 * qualifying block.
 *
 * Rules (design.md D4, D7.6, D22; `practice-sessions`: "Progression
 * suggestion follows the protocol rule" / "Practice requires a short intended
 * output" / "Practice metrics stay separate from benchmarks";
 * `identity-realm`: "Realms are never mixed in a result"):
 *  - Every row's `realm` MUST equal the caller's `realm` (the request's own
 *    realm, from `ctx.realm`). A mismatch throws `RealmMixingError` — this
 *    NEVER filters a mismatched row out silently, because a suggestion that
 *    quietly dropped a `pilot` row while computing a `demo` result would be
 *    exactly the kind of silent mixing the realm guard exists to prevent.
 *    The check runs over every input row, including rows this adapter will
 *    go on to discard for other reasons (benchmarks, abandoned sessions) —
 *    realm mixing is refused before any filtering happens, not after.
 *  - Only `kind: 'practice'` rows with `lifecycle !== 'abandoned'` are
 *    candidates for a block. Benchmark rows never enter (benchmark duration
 *    and benchmark counts are never inputs to progression) and an abandoned
 *    practice session never occupies a block, matching 4.2.1.
 *  - Candidates are grouped by `localDate` and, within each date, sorted by
 *    `startedAt`; only the first two become blocks for that date. A third (or
 *    later) session of a day is dropped before `suggestProgression` ever sees
 *    it — it is never passed through as an extra qualifying (or
 *    disqualifying) block.
 *  - Each kept row maps 1:1 onto a `PracticeBlockRecord`: `episodeCount`
 *    stays `null` when the row's is `null` (no `?? 0` — unknown is never
 *    promoted to zero) and `finalized` is `lifecycle === 'finalized'`
 *    (`running` / `paused` / `awaiting_review` never qualifies — timer expiry
 *    alone is never completion).
 *  - `deriveSuggestion` returns `null` outright for `day > 14` (there is no
 *    band ceiling beyond Day 14, so no suggestion is ever offered there),
 *    otherwise it defers entirely to `suggestProgression` for the
 *    two-consecutive-qualifying-day rule, the band ceiling and the
 *    `qualifiedOn` pair. No hold state is stored anywhere by this module —
 *    the suggestion is recomputed fresh on every call from the stored rows,
 *    until a revision (4.4.1) changes `currentTargetSeconds` or the
 *    qualifying pair no longer exists.
 */
import { RealmMixingError, suggestProgression } from '@attention-lab/shared'
import type {
  LocalDate,
  OutputQuality,
  PracticeBlockRecord,
  ProgressionSuggestion,
  Realm,
  ReportedCount,
  SessionKind,
  SessionLifecycle,
} from '@attention-lab/shared'

/**
 * One `focus_sessions` row (joined to its `session_reviews` row) for Days
 * 1..day-1 of a program, as loaded by `getToday` (4.5.3). Benchmark rows are
 * included on purpose — the realm check must see them — and are filtered out
 * by `toPracticeBlockRecords`, never by the caller's query.
 */
export interface SuggestionRow {
  readonly id: string
  readonly realm: Realm
  readonly kind: SessionKind
  readonly lifecycle: SessionLifecycle
  readonly localDate: LocalDate
  readonly startedAt: Date
  readonly targetSeconds: number
  readonly completeInterval: boolean | null
  readonly outputQuality: OutputQuality | null
  readonly episodeCount: ReportedCount
}

/**
 * Asserts every row's `realm` equals `realm` (the request's own realm).
 * Throws `RealmMixingError` on the first mismatch rather than filtering the
 * offending row out — mixed realms are a hard failure, never a silent drop.
 */
function assertRowsMatchRealm(rows: readonly SuggestionRow[], realm: Realm): void {
  for (const row of rows) {
    if (row.realm !== realm) {
      throw new RealmMixingError(
        `Refusing to combine a '${realm}' request with a '${row.realm}' record. ` +
          'Simulated and real results are never combined.',
      )
    }
  }
}

/**
 * Adapts stored session rows into `suggestProgression`'s `PracticeBlockRecord`
 * input: verifies realm, drops non-practice and abandoned rows, and keeps
 * only the first two candidates by `startedAt` for each local date.
 */
export function toPracticeBlockRecords(
  rows: readonly SuggestionRow[],
  realm: Realm,
): PracticeBlockRecord[] {
  assertRowsMatchRealm(rows, realm)

  const candidates = rows.filter(
    (row) => row.kind === 'practice' && row.lifecycle !== 'abandoned',
  )

  const byDate = new Map<LocalDate, SuggestionRow[]>()
  for (const row of candidates) {
    const existing = byDate.get(row.localDate)
    if (existing) {
      existing.push(row)
    } else {
      byDate.set(row.localDate, [row])
    }
  }

  const records: PracticeBlockRecord[] = []
  for (const dateRows of byDate.values()) {
    const firstTwo = dateRows
      .slice()
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .slice(0, 2)
    for (const row of firstTwo) {
      records.push({
        sessionId: row.id,
        realm: row.realm,
        kind: row.kind,
        localDate: row.localDate,
        targetSeconds: row.targetSeconds,
        completeInterval: row.completeInterval,
        outputQuality: row.outputQuality,
        episodeCount: row.episodeCount,
        finalized: row.lifecycle === 'finalized',
      })
    }
  }
  return records
}

export interface DeriveSuggestionInput {
  /** The program day the suggestion is being evaluated for (governs the ceiling). */
  readonly day: number
  readonly currentTargetSeconds: number
  readonly rows: readonly SuggestionRow[]
  readonly realm: Realm
}

/**
 * The Today-route entry point: adapts `rows` and defers to `suggestProgression`.
 * Returns `null` for `day > 14` before consulting `suggestProgression` at all
 * (there is no band beyond Day 14), and otherwise returns exactly what
 * `suggestProgression` returns. Throws `RealmMixingError` when `rows` mixes
 * realms, regardless of `day`.
 */
export function deriveSuggestion(input: DeriveSuggestionInput): ProgressionSuggestion | null {
  const { day, currentTargetSeconds, rows, realm } = input
  const blocks = toPracticeBlockRecords(rows, realm)
  if (day > 14) return null
  return suggestProgression({ day, currentTargetSeconds, blocks })
}

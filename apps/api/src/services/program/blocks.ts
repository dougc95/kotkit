/**
 * Task 4.2.1 — deriving Today's two practice-block statuses from a single
 * program-local date's `focus_sessions` rows. Pure: no database import, no
 * route registration. `getCurrentProgram`/`loadProgramSnapshot` (4.2.3)
 * loads a day's sessions joined to `session_reviews` and passes them here;
 * `nextAction.ts` (4.2.2) reads this function's output via
 * `nextPracticeBlock`.
 *
 * Rules (design.md's API contracts table, D22, and `practice-sessions`'s
 * "Today shows one next action and two blocks" / "Practice metrics stay
 * separate from benchmarks" / "Session review saves honest outcomes"):
 *  - Only `kind: 'practice'` rows with `lifecycle !== 'abandoned'` are
 *    candidates — a benchmark session on the same local date is never a
 *    block (practice metrics stay separate from benchmarks), and an
 *    abandoned practice session leaves its slot `not_started` rather than
 *    occupying it.
 *  - Candidates are ordered by `startedAt`; the first becomes block 1, the
 *    second block 2, and any further row (a third practice session of a
 *    day) is ignored.
 *  - Status: no candidate -> `not_started`; `running` | `paused` |
 *    `awaiting_review` -> `in_progress` (reaching the target only moves a
 *    session to `awaiting_review` — timer expiry never proves completion,
 *    so this is never `completed` until the review is finalized); finalized
 *    with `completeInterval === true` -> `completed`; finalized with
 *    `false` OR `null` -> `partial` (a null completion flag is never
 *    promoted to `completed` — "early finish" and "timing unknown" both
 *    read as partial). `outputQuality` never changes the status: partial
 *    output is not the same thing as a partial block.
 *  - `targetSeconds` on both blocks is always the caller-supplied value (the
 *    governing revision's practice target, per D33); no session field ever
 *    overrides it.
 */
import type {
  BlockStatus,
  OutputQuality,
  SessionKind,
  SessionLifecycle,
  TodayBlockValue,
} from '@attention-lab/shared'

/** One `focus_sessions` row (joined to its `session_reviews` row) for a single program-local date. */
export interface BlockSessionInput {
  readonly id: string
  readonly kind: SessionKind
  readonly lifecycle: SessionLifecycle
  readonly startedAt: Date
  /** `session_reviews.complete_interval`. `null` means not yet known — never treated as complete. */
  readonly completeInterval: boolean | null
  readonly outputQuality: OutputQuality | null
}

/**
 * The 2.7.3 `TodayResponse` block shape: `{ index, status, targetSeconds,
 * sessionId }`. `sessionId` is always present, `null` when the block has no
 * session — never omitted.
 */
export type Block = TodayBlockValue

/**
 * The status for a candidate that already occupies a block. Never called for
 * an empty block (see `buildBlock`) or for an `abandoned` session — those are
 * filtered out of the candidate list by `deriveBlocks` before this runs.
 */
function deriveStatus(session: BlockSessionInput): BlockStatus {
  switch (session.lifecycle) {
    case 'running':
    case 'paused':
    case 'awaiting_review':
      return 'in_progress'
    case 'finalized':
      return session.completeInterval === true ? 'completed' : 'partial'
    case 'abandoned':
      // Unreachable: deriveBlocks filters abandoned sessions out of the
      // candidate list before this ever runs.
      throw new Error('deriveBlocks: an abandoned session reached deriveStatus')
  }
}

function buildBlock(index: 1 | 2, session: BlockSessionInput | undefined, targetSeconds: number): Block {
  if (session === undefined) {
    return { index, status: 'not_started', targetSeconds, sessionId: null }
  }
  return { index, status: deriveStatus(session), targetSeconds, sessionId: session.id }
}

export interface DeriveBlocksInput {
  readonly sessions: readonly BlockSessionInput[]
  readonly targetSeconds: number
}

/**
 * Derives Today's two practice blocks from one local date's `focus_sessions`
 * rows. Benchmarks and abandoned sessions never occupy a block; the earliest
 * two remaining candidates by `startedAt` become blocks 1 and 2 in that
 * order, and a third or later candidate is ignored.
 */
export function deriveBlocks(input: DeriveBlocksInput): [Block, Block] {
  const candidates = input.sessions
    .filter((session) => session.kind === 'practice' && session.lifecycle !== 'abandoned')
    .slice()
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())

  return [
    buildBlock(1, candidates[0], input.targetSeconds),
    buildBlock(2, candidates[1], input.targetSeconds),
  ]
}

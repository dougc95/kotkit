/**
 * Pure Pending/Saved/Could-not-save derivation (task 7.3.3; design.md D6;
 * specs/session-recovery: "Pending, saved and could-not-save are distinct";
 * specs/app-shell: "Implementation details are not user-facing" / "Sync
 * state display"). `useOutbox.ts` (this task) is the only caller, but the
 * derivation is kept as a standalone pure function so its three-branch logic
 * (and the plain-word copy that renders it) can be reasoned about — and, if
 * ever needed, reused — independently of the hook's IndexedDB/network
 * plumbing.
 *
 * Priority, in order: any unacknowledged local write failure always wins
 * (the entry never made it into the buffer at all, so retrying the flush
 * cannot fix it — only `sendDirectNow()` can); otherwise any unsent row or
 * an in-flight flush means the batch was written locally but not yet
 * acknowledged; otherwise everything recorded has been acknowledged.
 * Dispatching a request is deliberately NOT enough on its own to reach
 * `saved` — only an acknowledgement is (spec: "The app MUST NOT show Saved
 * because a request was dispatched"); that is exactly the `inFlight`
 * branch below.
 */

export type SyncState = 'pending' | 'saved' | 'could_not_save'

export interface DeriveSyncStateInput {
  /** Rows written locally but not yet acknowledged by the server. */
  unsentCount: number
  /** Whether a flush request is currently in flight (dispatched, not yet settled). */
  inFlight: boolean
  /** Drafts whose local write itself failed and have not since been cleared (by `sendDirectNow()` succeeding). */
  localWriteFailures: readonly unknown[]
}

/** Plain-word copy for each state — never a technical identifier (app-shell: "Implementation details are not user-facing"). */
export const SYNC_STATE_COPY: Record<SyncState, string> = {
  pending: 'Pending',
  saved: 'Saved',
  could_not_save: 'Entries could not be saved on this device',
}

export function deriveSyncState({ unsentCount, inFlight, localWriteFailures }: DeriveSyncStateInput): SyncState {
  if (localWriteFailures.length > 0) {
    return 'could_not_save'
  }
  if (unsentCount > 0 || inFlight) {
    return 'pending'
  }
  return 'saved'
}

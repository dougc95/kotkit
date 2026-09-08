/**
 * `<SyncStatus sessionId>` — Pending / Saved / could-not-save, bound to the
 * outbox (task 8.5.2; renamed from SyncStateWord, absorbing 8.10.1 per
 * design.md D16). Used by Focus (8.5.3) and Benchmark Running (8.3.3);
 * mounted once per session screen, no other props. Renders plain words only
 * — never a technical identifier — and the two secondary actions the outbox
 * offers: Retry (while pending) and "Keep trying the server directly"
 * (while a local write could not be saved on this device).
 *
 * `role="status"`/`aria-live="polite"` update only when the derived sync
 * state actually changes (via `useOutboxStatus`'s `useSyncExternalStore`
 * snapshot, never a per-tick poll), so a screen's own countdown timer
 * re-rendering every second never re-announces this region.
 */
import { useOutboxStatus } from './useOutboxStatus.js'
import { Button } from '../../ui/Button.js'

export interface SyncStatusProps {
  sessionId: string
}

export function SyncStatus({ sessionId }: SyncStatusProps) {
  const { state, stateLabel, rejectedNotice, retry, sendDirectNow } = useOutboxStatus(sessionId)

  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
      <span>{stateLabel}</span>

      {state === 'pending' && (
        <Button
          variant="secondary"
          onClick={() => {
            void retry()
          }}
        >
          Retry
        </Button>
      )}

      {state === 'could_not_save' && (
        <Button
          variant="secondary"
          onClick={() => {
            void sendDirectNow()
          }}
        >
          Keep trying the server directly
        </Button>
      )}

      {rejectedNotice !== null && <span>{rejectedNotice}</span>}
    </div>
  )
}

/**
 * `ClockGapPrompt` — the clock-gap resolution dialog (task 8.10.2; design.md
 * D5, D25, D26; specs/session-recovery: "Clock gaps are detected and
 * resolved by the user" / "Laptop slept during a benchmark", "Laptop slept
 * during a benchmark" / "Deadline passed during sleep", "Abandon and
 * save-incomplete are always available" / "Save incomplete after
 * uncertainty").
 *
 * Mounted once by `SessionLayout` (7.1.4, on this task's never-edit list)
 * whenever `['sessions','active']` reports `running` or `paused` — so
 * Focus, a running benchmark, recall and scoring all get this prompt without
 * any of those screens importing or rendering it themselves. The exact
 * mounting edit is reported as a `centralWiringNeeded` item rather than
 * applied here.
 *
 * All state/network/outbox logic lives in `useClockGap` (this file's
 * sibling) — this component only renders what that hook reports: a Radix
 * `AlertDialog` that cannot be dismissed by outside click or Escape (`Yes,
 * it continued` / `No` / `Not sure` / `Save as incomplete`, D26's exact
 * copy), a "Timing uncertain" chip once `timerQuality` reads `uncertain`,
 * and an "Awaiting review" note once the latest known remaining time is
 * ≤ 0 — never the word "completed" (D24: a GET/client timer never confirms
 * completion).
 */
import { AlertDialog } from 'radix-ui'
import type { SessionResponseValue } from '@attention-lab/shared'

import { Button } from '../../ui/Button.js'
import { useClockGap, type CreateGapDetector } from './useClockGap.js'

export interface ClockGapPromptProps {
  readonly session: SessionResponseValue
  /** Test-only: substitutes the real 7.2 heartbeat detector. Defaults to it. */
  readonly createDetector?: CreateGapDetector
}

export function ClockGapPrompt({ session, createDetector }: ClockGapPromptProps) {
  const { pendingGap, status, errorMessage, latestSession, resolve } = useClockGap(session, createDetector)

  const open = pendingGap !== null
  const isPending = status === 'pending'

  return (
    <>
      <AlertDialog.Root open={open} onOpenChange={() => {}}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay data-testid="clock-gap-overlay" className="fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg"
            onEscapeKeyDown={(event) => event.preventDefault()}
          >
            {/* Outside click/interact are already unconditionally prevented
                inside Radix's own AlertDialogContent (`onPointerDownOutside`/
                `onInteractOutside` are deliberately omitted from its public
                props so a consumer cannot weaken that) — only Escape needs
                suppressing here. */}
            <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
              Did the interval continue uninterrupted?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
              Your device&apos;s clock and the session timer disagreed by more than a minute — this can happen when
              a laptop sleeps or a system clock changes.
            </AlertDialog.Description>

            {errorMessage !== null ? (
              <p role="alert" className="mt-3 text-sm text-[var(--color-text-muted)]">
                {errorMessage}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-2">
              <Button variant="primary" disabled={isPending} onClick={() => void resolve('continued')}>
                Yes, it continued
              </Button>
              <Button variant="secondary" disabled={isPending} onClick={() => void resolve('uncertain')}>
                No
              </Button>
              <Button variant="secondary" disabled={isPending} onClick={() => void resolve('uncertain')}>
                Not sure
              </Button>
              <Button variant="quiet" disabled={isPending} onClick={() => void resolve('save_incomplete')}>
                Save as incomplete
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {latestSession.timerQuality === 'uncertain' ? (
        <p
          role="status"
          className="fixed bottom-4 left-4 z-40 inline-block rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
        >
          Timing uncertain
        </p>
      ) : null}

      {latestSession.timing.remainingSeconds <= 0 ? (
        <p role="status" className="fixed bottom-4 left-32 z-40 text-xs text-[var(--color-text-muted)]">
          Awaiting review
        </p>
      ) : null}
    </>
  )
}

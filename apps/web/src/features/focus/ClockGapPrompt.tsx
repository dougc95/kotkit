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
import type { SessionResponseValue } from '@attention-lab/shared'

import { Button } from '../../ui/Button.js'
import { Reported } from '../../ui/Reported.js'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
} from '../../ui/shadcn/alert-dialog.js'
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
      <AlertDialog open={open} onOpenChange={() => {}}>
        {/* `AlertDialogContent` (below) already renders its own
            `AlertDialogPortal`/`AlertDialogOverlay` internally — this extra,
            explicit `AlertDialogOverlay` exists solely so the existing
            'Escape and outside click do not close the dialog' case has a
            real, addressable `data-testid="clock-gap-overlay"` element to
            click (the component's frozen `AlertDialogContent` wrapper takes
            no prop that would let a testid reach ITS internal overlay). It
            is made `bg-transparent` so it never doubles the dimming the real,
            internal overlay already draws. */}
        <AlertDialogPortal>
          <AlertDialogOverlay data-testid="clock-gap-overlay" className="bg-transparent" />
        </AlertDialogPortal>
        <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
          {/* Outside click/interact are already unconditionally prevented
              inside Radix's own AlertDialogContent (`onPointerDownOutside`/
              `onInteractOutside` are deliberately omitted from its public
              props so a consumer cannot weaken that) — only Escape needs
              suppressing here. */}
          <AlertDialogTitle>Did the interval continue uninterrupted?</AlertDialogTitle>
          <AlertDialogDescription>
            Your device&apos;s clock and the session timer disagreed by more than a minute — this can happen when
            a laptop sleeps or a system clock changes.
          </AlertDialogDescription>

          {errorMessage !== null ? (
            <p role="alert" className="mt-3 text-sm text-attention">
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
            <Button
              variant="quiet"
              className="hover:bg-paper"
              disabled={isPending}
              onClick={() => void resolve('save_incomplete')}
            >
              Save as incomplete
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {latestSession.timerQuality === 'uncertain' ? (
        <p role="status" className="fixed bottom-4 left-4 z-40 inline-block rounded-full border border-rule bg-card px-2 py-0.5 text-xs">
          <Reported>Timing uncertain</Reported>
        </p>
      ) : null}

      {latestSession.timing.remainingSeconds <= 0 ? (
        <p role="status" className="fixed bottom-4 left-32 z-40 text-xs text-ink-muted">
          Awaiting review
        </p>
      ) : null}
    </>
  )
}

/**
 * "Explain or exclude" amendment control (task 8.8.6; design.md D4, D32;
 * benchmark-assessment: "Finalized attempts are immutable; amendments are
 * append-only" / "Exclude a finalized attempt").
 *
 * Meant to be mounted, per finalized row, from `AttemptTable` (8.8.1 — an
 * earlier wave that left a commented TODO placeholder in that file's last
 * column). This file is fully self-contained: `AttemptTable.tsx` is never
 * edited here (see this task's `centralWiringNeeded` report for the exact
 * edit a human applies once).
 *
 * A finalized attempt's counts, recall and eligibility are never rewritten
 * client-side (D4) — this dialog only ever POSTs a new `session_amendments`
 * row and invalidates the Progress report query so the SERVER-computed
 * `excludedByAmendment` overlay (5.9.2/5.9.3) is what the table shows after
 * refetch. `AmendmentList` renders exactly the `amendments` this component
 * was given (plus, once created, the verbatim 201 response of this
 * session's own new amendment) — reason, exclude flag and createdAt, in
 * creation order — never a locally recomputed eligibility or exclusion
 * reason.
 */
import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { AmendmentBodyValue, AmendmentResponseValue } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { Button } from '../../ui/Button.js'
import { useField } from '../../ui/field.js'
import { Checkbox } from '../../ui/shadcn/checkbox.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../ui/shadcn/dialog.js'
import { Textarea } from '../../ui/shadcn/textarea.js'

// ---------------------------------------------------------------------------
// Error shape — matches both a real `ApiError` instance and mockClient's
// plain-object stand-in (CheckinForm.tsx/Preferences.tsx's own pattern: each
// call site declares this locally rather than importing a shared helper).
// ---------------------------------------------------------------------------

interface StructuredApiError {
  readonly status: number
  readonly code: string
  readonly fieldErrors?: Record<string, string | ReadonlyArray<string>>
}

function isStructuredApiError(error: unknown): error is StructuredApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { status?: unknown }).status === 'number' &&
    typeof (error as { code?: unknown }).code === 'string'
  )
}

/** A field-error value is a single string on the real wire (D18) but mockClient's `reject()` types it as `string[]`; either is read as its first/only message. */
function fieldErrorText(value: string | ReadonlyArray<string> | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

const REASON_REQUIRED_MESSAGE = 'A reason is required'
const NOT_FINALIZED_MESSAGE = 'This attempt is no longer finalized'
const SAVE_ERROR_MESSAGE = 'Could not save. Retry.'

/**
 * Invalidates every cached `['programs', <id>, 'report']` query (8.8.1's
 * `queryKeys.report`) without this component needing to know which program
 * the session belongs to — its own props are exactly `{ sessionId,
 * amendments }` (no `programId`), so a key-shape predicate stands in for
 * `queryKeys.report(programId)` at the one call site that cannot supply it.
 */
function invalidateReportQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey
      return Array.isArray(key) && key[0] === 'programs' && key[key.length - 1] === 'report'
    },
  })
}

// ---------------------------------------------------------------------------
// AmendmentList
// ---------------------------------------------------------------------------

export interface AmendmentListProps {
  readonly amendments: readonly AmendmentResponseValue[]
}

/** Renders exactly the amendments it is given, in the order given (creation order) — no sorting, filtering or recomputation. */
export function AmendmentList({ amendments }: AmendmentListProps) {
  if (amendments.length === 0) {
    return <p className="text-sm text-ink-muted">No amendments yet.</p>
  }

  return (
    <ul className="flex flex-col">
      {amendments.map((amendment) => (
        <li key={amendment.id} className="border-b border-rule py-2 text-sm last:border-b-0">
          <p className="text-ink">{amendment.reason}</p>
          <p className="text-ink-muted">
            {amendment.excludeFromReport ? 'Excluded from the comparison' : 'Not excluded'}
          </p>
          <p className="text-xs text-ink-muted">{amendment.createdAt}</p>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// AmendmentDialog
// ---------------------------------------------------------------------------

export interface AmendmentDialogProps {
  readonly sessionId: string
  readonly amendments: readonly AmendmentResponseValue[]
}

export function AmendmentDialog({ sessionId, amendments }: AmendmentDialogProps) {
  const queryClient = useQueryClient()
  const excludeId = useId()

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [excludeFromReport, setExcludeFromReport] = useState(false)
  const [created, setCreated] = useState<readonly AmendmentResponseValue[]>([])
  const [reasonRequiredError, setReasonRequiredError] = useState(false)
  const [fieldError, setFieldError] = useState<string | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Only set after a 409 not_finalized closes the dialog — shown outside it, since Radix does not render Content while closed. */
  const [notice, setNotice] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (body: AmendmentBodyValue) => api.sessions.amend(sessionId, body),
    onSuccess: (amendment) => {
      setCreated((previous) => [...previous, amendment])
      invalidateReportQueries(queryClient)
      setOpen(false)
      resetDraft()
    },
    onError: (error: unknown) => {
      if (isStructuredApiError(error)) {
        if (error.status === 409 && error.code === 'not_finalized') {
          setOpen(false)
          resetDraft()
          setNotice(NOT_FINALIZED_MESSAGE)
          return
        }
        if (error.status === 400) {
          const message = fieldErrorText(error.fieldErrors?.reason)
          if (message !== undefined) {
            setFieldError(message)
            return
          }
        }
      }
      setSaveError(SAVE_ERROR_MESSAGE)
    },
  })

  function resetDraft(): void {
    setReason('')
    setExcludeFromReport(false)
    setReasonRequiredError(false)
    setFieldError(undefined)
    setSaveError(null)
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (mutation.isPending) {
      return
    }
    setOpen(nextOpen)
    if (nextOpen) {
      // Stale from a previous, now-closed dialog instance — cleared on reopen.
      setNotice(null)
    } else {
      resetDraft()
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      setReasonRequiredError(true)
      return
    }
    setReasonRequiredError(false)
    setFieldError(undefined)
    setSaveError(null)
    mutation.mutate({ reason: trimmed, excludeFromReport })
  }

  const allAmendments = [...amendments, ...created]
  const isPending = mutation.isPending
  // `useField` owns id generation and the aria-describedby/aria-invalid
  // wiring the reason textarea previously lacked entirely (the rework spec §9,
  // defect 2 — "only OutputQualityField wires its error correctly").
  // `reasonRequiredError` and `fieldError` are mutually exclusive in
  // practice (a 400 field error can only arrive from a submit that already
  // passed the empty-reason check), so a single `useField` call covers both.
  const reasonError = reasonRequiredError ? REASON_REQUIRED_MESSAGE : fieldError
  const reasonField = useField({ name: 'amendment-reason', error: reasonError ?? null, required: true })

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button variant="secondary">Explain or exclude</Button>
        </DialogTrigger>
        {/* `showCloseButton={false}`: the generated X is a 16 px icon-only
            target (`absolute top-4 right-4`, a `size-4` icon, no padding),
            under this project's explicit 24 px hit-area floor
            (`e2e/a11y/axe-shell.spec.ts`, WCAG 2.2 AA 2.5.8, D40) and its own
            44 px controls. The labelled `Cancel` button below already does
            the same job, and Escape still closes the dialog. */}
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Explain or exclude this attempt</DialogTitle>
            <DialogDescription>
              This attempt&apos;s stored counts, recall and score never change. A reason is kept alongside it,
              optionally excluding it from the comparison.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <AmendmentList amendments={allAmendments} />
          </div>

          <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1">
              <label {...reasonField.labelProps} className="text-sm font-medium text-ink">
                Reason
              </label>
              <Textarea
                {...reasonField.controlProps}
                value={reason}
                disabled={isPending}
                className="min-h-20"
                onChange={(event) => {
                  setReason(event.target.value)
                }}
              />
              {reasonField.errorProps !== undefined ? (
                // attention, never red or neutral ink: spec decision U15a says a
                // validation error message takes `text-attention`, not the
                // shadcn primitive's own destructive red and not the neutral
                // ink a data-absence cell uses. This reuses the same amber
                // `--color-attention` token the three-tier taxonomy's
                // UNCERTAIN tier renders in (§5: 'Unknown', 'Timing
                // uncertain'), but for a different reason: there it names an
                // uncertain data state, here it draws the eye to a form
                // validation prompt that blocks submission.
                <p {...reasonField.errorProps} className="text-sm text-attention">
                  {reasonError}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2 text-sm text-ink">
              <Checkbox
                id={excludeId}
                checked={excludeFromReport}
                disabled={isPending}
                onCheckedChange={(checked) => {
                  setExcludeFromReport(checked === true)
                }}
              />
              <label htmlFor={excludeId}>Exclude from the comparison</label>
            </div>

            {saveError !== null ? (
              <p role="alert" className="text-sm text-attention">
                {saveError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {notice !== null ? (
        <p role="status" className="mt-1 text-xs text-ink-muted">
          {notice}
        </p>
      ) : null}
    </>
  )
}

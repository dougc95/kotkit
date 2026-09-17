import { Alert, AlertDescription, AlertTitle } from './shadcn/alert.js'
import { Button } from './Button.js'

export interface ErrorStateProps {
  readonly children: string
  readonly onRetry: () => void
  readonly retryLabel?: string
  readonly retryDisabled?: boolean
}

/**
 * The app-wide retry/error treatment (the rework spec §8 "Shell and chrome"):
 * a shadcn Alert (role="alert") carrying the message and a Retry action.
 * Replaces every hand-rolled `<div><p>message</p><Button>Retry</Button></div>`.
 * `retryLabel` defaults to 'Retry' so every existing call site's accessible
 * name is unchanged by adopting this component. The surface is the neutral
 * `card` (the default, non-destructive Alert variant — never `destructive`);
 * the message itself takes `text-attention`, because an error is a message
 * you must act on, not recorded or informational content (spec U15a: never
 * red, never neutral ink). `line-clamp-none` overrides the generated
 * `AlertTitle`'s `line-clamp-1` so a longer error is never silently clipped.
 */
export function ErrorState({ children, onRetry, retryLabel = 'Retry', retryDisabled = false }: ErrorStateProps) {
  return (
    <Alert>
      <AlertTitle className="line-clamp-none text-attention">{children}</AlertTitle>
      <AlertDescription>
        <Button onClick={onRetry} disabled={retryDisabled}>
          {retryLabel}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

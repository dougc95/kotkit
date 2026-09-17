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
 * name is unchanged by adopting this component. Uses the default (non-red)
 * Alert variant — an error surface is never given the destructive treatment.
 */
export function ErrorState({ children, onRetry, retryLabel = 'Retry', retryDisabled = false }: ErrorStateProps) {
  return (
    <Alert>
      <AlertTitle>{children}</AlertTitle>
      <AlertDescription>
        <Button onClick={onRetry} disabled={retryDisabled}>
          {retryLabel}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

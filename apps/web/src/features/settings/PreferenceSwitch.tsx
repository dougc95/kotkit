import { useId } from 'react'

import { Label } from '../../ui/shadcn/label.js'
import { Switch } from '../../ui/shadcn/switch.js'

/**
 * One labeled toggle row. `label` is associated via a real `<label htmlFor>`
 * so `getByRole('switch', { name: label })` finds it directly, and
 * `description` is wired through `aria-describedby` rather than folded into
 * the accessible name.
 */
export interface PreferenceSwitchProps {
  readonly label: string
  readonly description: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly disabled?: boolean
}

export function PreferenceSwitch({ label, description, checked, onCheckedChange, disabled }: PreferenceSwitchProps) {
  const switchId = useId()
  const descriptionId = useId()

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={switchId} className="text-sm font-medium text-ink">
          {label}
        </Label>
        <p id={descriptionId} className="text-sm text-ink-muted">
          {description}
        </p>
      </div>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={descriptionId}
        disabled={disabled}
        // The generated Switch track is ~18.4 x 32px, under D40's 24px touch-
        // target floor and short of the app's 44px convention. Its size is
        // never overridden here — the thumb's `size-4` and its
        // `translate-x-[calc(100%-2px)]` travel are tuned to the 32px track,
        // so widening the track would strand the thumb mid-travel. Instead a
        // pseudo-element on the switch's own `<button>` extends the
        // clickable/tappable area to ~44 x 44px while the track, thumb and
        // focus outline stay exactly where the primitive draws them.
        className="relative mt-0.5 shrink-0 after:absolute after:-inset-x-1.5 after:-inset-y-[13px] after:content-['']"
      />
    </div>
  )
}

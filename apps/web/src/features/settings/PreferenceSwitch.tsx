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
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}

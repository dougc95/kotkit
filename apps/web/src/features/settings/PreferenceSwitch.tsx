import { useId } from 'react'
import { Switch } from 'radix-ui'

/**
 * One labeled toggle row (task 8.9.2). A thin wrapper over Radix's
 * `Switch.Root`/`Switch.Thumb` (role="switch", `aria-checked` managed by
 * Radix itself) — `label` is associated via a real `<label htmlFor>` (a
 * Radix switch renders a `<button>`, a labelable element per the HTML
 * spec) so `getByRole('switch', { name: label })` finds it directly, and
 * `description` is wired through `aria-describedby` rather than folded into
 * the accessible name, so a screen reader announces the control's state
 * change without re-reading the whole sentence every time.
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
        <label htmlFor={switchId} className="text-sm font-medium text-[var(--color-text)]">
          {label}
        </label>
        <p id={descriptionId} className="text-sm text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>
      <Switch.Root
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={descriptionId}
        disabled={disabled}
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-[var(--color-border)] outline-none transition-colors disabled:opacity-50 data-[state=checked]:bg-[var(--color-primary)]"
      >
        <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition-transform will-change-transform data-[state=checked]:translate-x-[22px]" />
      </Switch.Root>
    </div>
  )
}

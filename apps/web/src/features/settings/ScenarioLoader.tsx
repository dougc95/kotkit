import { useCallback, useId, useState } from 'react'
import { AlertDialog, Select } from 'radix-ui'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DEMO_SCENARIO_NAMES, DEMO_SCENARIOS, type DemoScenarioName } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { Button } from '../../ui/Button.js'

/**
 * The scenario-load section of `DemoControls` (task 8.9.3; design.md D22 —
 * `POST /demo/scenarios/{name}/load` takes no body, the confirmation
 * dialog IS the consent step — and D35's scenario registry). The Radix
 * `Select` lists every `DemoScenarioName` in `DEMO_SCENARIO_NAMES`'s fixed
 * order ("the order they are offered in Settings/demo controls",
 * domain/types.ts); `DEMO_SCENARIOS[name].description` supplies the
 * supporting copy for whichever name is currently selected.
 *
 * `Select.Content` uses `position="popper"` rather than Radix's default
 * item-aligned positioning — the item-aligned mode measures against the
 * real viewport/anchor geometry, which jsdom (this file's own test
 * environment) does not provide meaningfully.
 *
 * Confirming re-posts the SAME scenario name is a caller can retry after a
 * failure without re-opening the Select. On success the whole query cache
 * is cleared (this task's own "State" note) and the app navigates to
 * `/progress`, where the loaded scenario's result state is visible.
 */
function humanizeScenarioName(name: DemoScenarioName): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function ScenarioLoader() {
  const [selected, setSelected] = useState<DemoScenarioName>(DEMO_SCENARIO_NAMES[0])
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const triggerId = useId()

  // See TransitionControls.tsx's identical comment: Radix's AlertDialog does
  // not auto-focus its content on open in this app (confirmed empirically),
  // so focus into the dialog is moved explicitly via a callback ref — not a
  // `useEffect` (also confirmed empirically: `AlertDialog.Content` portals
  // its children, so an effect keyed on `open` can run before "Cancel"'s own
  // DOM node exists) — which React calls exactly when the node mounts.
  const focusOnMount = useCallback((node: HTMLButtonElement | null) => {
    node?.focus()
  }, [])

  const loadMutation = useMutation({
    mutationFn: (name: DemoScenarioName) => api.demo.loadScenario(name),
    onSuccess: () => {
      queryClient.clear()
      setOpen(false)
      navigate('/progress')
    },
  })

  function handleOpenChange(next: boolean) {
    if (loadMutation.isPending) {
      return
    }
    setOpen(next)
  }

  function handleConfirm() {
    loadMutation.mutate(selected)
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">Load a demonstration scenario</h3>

      <div className="flex flex-col gap-1">
        <label htmlFor={triggerId} className="text-sm font-medium text-[var(--color-text)]">
          Demonstration scenario
        </label>
        <Select.Root value={selected} onValueChange={(value) => setSelected(value as DemoScenarioName)}>
          <Select.Trigger
            id={triggerId}
            className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
          >
            <Select.Value />
            <Select.Icon aria-hidden="true">▾</Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              position="popper"
              sideOffset={4}
              className="z-50 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] shadow-lg"
            >
              <Select.Viewport className="p-1">
                {DEMO_SCENARIO_NAMES.map((name) => (
                  <Select.Item
                    key={name}
                    value={name}
                    className="cursor-pointer rounded px-3 py-2 text-sm outline-none data-[highlighted]:bg-[var(--color-surface)]"
                  >
                    <Select.ItemText>{humanizeScenarioName(name)}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
        <p className="text-sm text-[var(--color-text-muted)]">{DEMO_SCENARIOS[selected].description}</p>
      </div>

      <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
        <AlertDialog.Trigger asChild>
          <Button variant="secondary">Load scenario</Button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-lg">
            <AlertDialog.Title className="text-base font-semibold text-[var(--color-text)]">
              Load &ldquo;{humanizeScenarioName(selected)}&rdquo;?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-[var(--color-text-muted)]">
              This replaces all demonstration data for this profile
            </AlertDialog.Description>

            {loadMutation.isError ? (
              <p role="alert" className="mt-3 text-sm text-[var(--color-text-muted)]">
                Could not load the scenario. Retry.
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                ref={focusOnMount}
                variant="secondary"
                disabled={loadMutation.isPending}
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button variant="primary" disabled={loadMutation.isPending} onClick={handleConfirm}>
                Load
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  )
}

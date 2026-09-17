import { useCallback, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DEMO_SCENARIO_NAMES, DEMO_SCENARIOS, type DemoScenarioName } from '@attention-lab/shared'

import { api } from '../../lib/api/client.js'
import { Button } from '../../ui/Button.js'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../ui/shadcn/alert-dialog.js'
import { Label } from '../../ui/shadcn/label.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/shadcn/select.js'

/**
 * The scenario-load section of `DemoControls`. `POST
 * /demo/scenarios/{name}/load` takes no body — the confirmation dialog IS
 * the consent step. Confirming re-posts the same scenario name so a caller
 * can retry after a failure without re-opening the Select. On success the
 * whole query cache is cleared and the app navigates to `/progress`.
 */
function humanizeScenarioName(name: DemoScenarioName): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function isDemoScenarioName(value: string): value is DemoScenarioName {
  return (DEMO_SCENARIO_NAMES as readonly string[]).includes(value)
}

export function ScenarioLoader() {
  const [selected, setSelected] = useState<DemoScenarioName>(DEMO_SCENARIO_NAMES[0])
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const triggerId = useId()

  // Radix's AlertDialog does not auto-focus its content on open in this
  // app, so focus into the dialog is moved explicitly via a callback ref —
  // not a `useEffect` (AlertDialogContent portals its children, so an
  // effect keyed on `open` can run before "Cancel"'s own DOM node exists).
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

  function handleSelectChange(value: string) {
    if (isDemoScenarioName(value)) {
      setSelected(value)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">Load a demonstration scenario</h3>

      <div className="flex flex-col gap-1">
        <Label htmlFor={triggerId} className="text-sm font-medium text-ink">
          Demonstration scenario
        </Label>
        <Select value={selected} onValueChange={handleSelectChange}>
          <SelectTrigger id={triggerId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEMO_SCENARIO_NAMES.map((name) => (
              <SelectItem key={name} value={name}>
                {humanizeScenarioName(name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-ink-muted">{DEMO_SCENARIOS[selected].description}</p>
      </div>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogTrigger asChild>
          <Button variant="secondary" className="self-start">
            Load scenario
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load &ldquo;{humanizeScenarioName(selected)}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>This replaces all demonstration data for this profile</AlertDialogDescription>
          </AlertDialogHeader>

          {loadMutation.isError ? (
            <p role="alert" className="text-sm text-attention">
              Could not load the scenario. Retry.
            </p>
          ) : null}

          <AlertDialogFooter>
            <Button
              ref={focusOnMount}
              variant="secondary"
              disabled={loadMutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              className="border-destructive text-destructive hover:bg-destructive/10"
              disabled={loadMutation.isPending}
              onClick={handleConfirm}
            >
              Load
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

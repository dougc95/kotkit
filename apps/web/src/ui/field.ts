import { useId } from 'react'

export interface FieldWiring {
  readonly inputId: string
  readonly labelProps: { readonly htmlFor: string }
  readonly controlProps: {
    readonly id: string
    readonly 'aria-describedby': string | undefined
    readonly 'aria-invalid': true | undefined
    readonly 'aria-required': true | undefined
  }
  readonly descriptionProps: { readonly id: string } | undefined
  readonly errorProps: { readonly id: string; readonly role: 'alert' } | undefined
}

export interface UseFieldOptions {
  readonly name: string
  readonly description?: string | undefined
  readonly error?: string | null | undefined
  readonly required?: boolean | undefined
}

/**
 * Generates ids and the ARIA wiring for one form control, without imposing a
 * markup shape — every form in this app is controlled with manual submit
 * handling, and its structure is asserted by tests.
 *
 * `aria-describedby` lists the description before the error, so a screen
 * reader hears the constraint before the complaint. It is omitted entirely
 * rather than set to an empty string when there is neither.
 */
export function useField({ name, description, error, required }: UseFieldOptions): FieldWiring {
  const scope = useId()
  const inputId = `${scope}-${name}`
  const descriptionId = `${inputId}-description`
  const errorId = `${inputId}-error`

  const hasDescription = description !== undefined && description !== ''
  const hasError = error !== undefined && error !== null && error !== ''

  const describedBy = [hasDescription ? descriptionId : undefined, hasError ? errorId : undefined]
    .filter((id): id is string => id !== undefined)
    .join(' ')

  return {
    inputId,
    labelProps: { htmlFor: inputId },
    controlProps: {
      id: inputId,
      'aria-describedby': describedBy === '' ? undefined : describedBy,
      'aria-invalid': hasError ? true : undefined,
      'aria-required': required === true ? true : undefined,
    },
    descriptionProps: hasDescription ? { id: descriptionId } : undefined,
    errorProps: hasError ? { id: errorId, role: 'alert' } : undefined,
  }
}

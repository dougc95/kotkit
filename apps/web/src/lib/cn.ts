import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Class merge used by every generated shadcn primitive. `twMerge` resolves
 * Tailwind conflicts last-wins, so a caller's `className` always beats the
 * component's own defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

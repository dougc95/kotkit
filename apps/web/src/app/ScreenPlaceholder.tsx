export interface ScreenPlaceholderProps {
  name: string
}

/**
 * Stand-in for every screen route until group 8 replaces it with the real
 * component. Renders only the screen's name — no session or program data,
 * so it never violates "Implementation details are not user-facing"
 * (app-shell spec) by accident.
 */
export function ScreenPlaceholder({ name }: ScreenPlaceholderProps) {
  return (
    <main>
      <h1>{name}</h1>
    </main>
  )
}

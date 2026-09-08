const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const REALM_WORD_PATTERN = /\b(demo|pilot)\b/i

/**
 * Asserts a rendered container's text contains no user-facing identifier
 * (app-shell spec: "Implementation details are not user-facing") and
 * neither raw realm word as a standalone token (identity-realm spec: realm
 * is never a user-facing label). Throws with the offending text on failure.
 */
export function expectNoIdentifiers(container: HTMLElement): void {
  const text = container.textContent ?? ''

  if (UUID_PATTERN.test(text)) {
    throw new Error(`expectNoIdentifiers: rendered text contains a UUID-like identifier:\n${text}`)
  }

  if (REALM_WORD_PATTERN.test(text)) {
    throw new Error(
      `expectNoIdentifiers: rendered text contains a raw realm word ('demo'/'pilot'):\n${text}`,
    )
  }
}

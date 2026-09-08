/**
 * Canonical JSON and the request-hash primitive `withIdempotency` (3.4.2)
 * uses to detect whether a replayed `Idempotency-Key` carries the same
 * content as the first request, or a different one (409
 * `idempotency_mismatch`, D19/D21).
 *
 * `canonicalJson` is deliberately its own export, unit-tested directly: the
 * whole point is that key order never changes the hash while array order and
 * "unknown vs zero vs absent" always do (measurement integrity — see
 * `domain/types.ts` on why `ReportedCount` is never coalesced).
 */
import { createHash } from 'node:crypto'

/**
 * Recursively normalizes a JSON-ish value: object keys are sorted so
 * `{a:1,b:2}` and `{b:2,a:1}` produce identical output at every nesting
 * depth; array element order is preserved (an array is data, not a set); an
 * object property whose value is `undefined` is dropped, exactly like
 * `JSON.stringify` already does for object properties, so it never needs a
 * caller-side `?? null`; `null` is preserved as the literal `null` — it is a
 * distinct, real value ("unreported"), never folded into "absent" or "0".
 */
function canonicalize(value: unknown): unknown {
  if (value === null) return null

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sortedKeys = Object.keys(source).sort()
    const result: Record<string, unknown> = {}
    for (const key of sortedKeys) {
      const propertyValue = source[key]
      if (propertyValue === undefined) continue
      result[key] = canonicalize(propertyValue)
    }
    return result
  }

  return value
}

/**
 * `JSON.stringify` of `canonicalize(value)`. Because `canonicalize` already
 * inserts object keys in sorted order and `JSON.stringify` preserves
 * insertion order for string keys, the resulting text is stable across two
 * objects that differ only in the order their keys were written.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/**
 * `sha256(operation + '\n' + canonicalJson({ params, body }))`, hex-encoded.
 * `operation` and `params` are folded into the hash (not just `body`) so the
 * same body sent to a different logical operation, or with different route
 * params, never collides with an unrelated request that happens to reuse the
 * same `Idempotency-Key` value.
 */
export function requestHash(operation: string, params: object, body: unknown): string {
  const canonical = canonicalJson({ params, body })
  return createHash('sha256').update(`${operation}\n${canonical}`).digest('hex')
}

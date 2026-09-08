import type { DestinationStream } from 'pino'

/**
 * A pino destination that collects every JSON line written to it in memory,
 * so tests can assert on log output without touching stdout/stderr or a
 * real file. `write` is the only method pino itself calls; the rest are
 * assertion helpers for tests (3.2.1's API test foundation, design.md D16).
 */
export interface CapturedLogs extends DestinationStream {
  /** Every raw string handed to `write`, in call order, unparsed. */
  lines(): string[]
  /** Every raw line concatenated, in call order. */
  text(): string
  /** Every non-blank line parsed as JSON, in call order. */
  entries(): Record<string, unknown>[]
  /** `entries()` filtered to those whose top-level `reqId` matches. */
  entriesWith(reqId: string): Record<string, unknown>[]
}

export function captureLogs(): CapturedLogs {
  const raw: string[] = []

  const entries = (): Record<string, unknown>[] =>
    raw
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)

  return {
    write(msg: string): void {
      raw.push(msg)
    },
    lines(): string[] {
      return [...raw]
    },
    text(): string {
      return raw.join('')
    },
    entries,
    entriesWith(reqId: string): Record<string, unknown>[] {
      return entries().filter((entry) => entry.reqId === reqId)
    },
  }
}

import { describe, expect, it } from 'vitest'
import { deriveSyncState, SYNC_STATE_COPY } from './syncState.js'

describe('syncState', () => {
  it('SYNC_STATE_COPY values match no UUID fragment /[0-9a-f]{8}-/i', () => {
    const UUID_FRAGMENT_RE = /[0-9a-f]{8}-/i

    for (const value of Object.values(SYNC_STATE_COPY)) {
      expect(value).not.toMatch(UUID_FRAGMENT_RE)
    }

    // Plain-word copy, exactly as specs/app-shell's "Sync state display"
    // scenario names it.
    expect(SYNC_STATE_COPY.pending).toBe('Pending')
    expect(SYNC_STATE_COPY.saved).toBe('Saved')
    expect(SYNC_STATE_COPY.could_not_save).toBe('Entries could not be saved on this device')

    // The pure derivation itself (each SYNC_STATE_COPY key is reachable):
    // a local write failure always wins regardless of unsentCount/inFlight,
    // an unsent row or an in-flight flush is pending, and dispatching a
    // request alone (inFlight without ever incrementing unsentCount) is
    // never enough to reach saved.
    expect(deriveSyncState({ unsentCount: 0, inFlight: false, localWriteFailures: [{}] })).toBe('could_not_save')
    expect(
      deriveSyncState({ unsentCount: 3, inFlight: false, localWriteFailures: [{}] }),
    ).toBe('could_not_save')
    expect(deriveSyncState({ unsentCount: 2, inFlight: false, localWriteFailures: [] })).toBe('pending')
    expect(deriveSyncState({ unsentCount: 0, inFlight: true, localWriteFailures: [] })).toBe('pending')
    expect(deriveSyncState({ unsentCount: 0, inFlight: false, localWriteFailures: [] })).toBe('saved')
  })
})

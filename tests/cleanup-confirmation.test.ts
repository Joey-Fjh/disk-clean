import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import {
  clearCleanupConfirmationStoreForTests,
  consumeCleanupConfirmation,
  createCleanupConfirmation,
  getCleanupConfirmationStoreSizeForTests,
  getCleanupPendingStoreSizeForTests,
  getCleanupTombstoneStoreSizeForTests,
  peekCleanupConfirmation,
  seedConsumedTombstoneForTests
} from '../src/main/cleanup/cleanup-confirmation-store'
import {
  CLEANUP_CONFIRMATION_TTL_MS,
  CLEANUP_CONFIRMATION_TOMBSTONE_TTL_MS,
  MAX_CLEANUP_CONFIRMATION_STORE_ENTRIES
} from '../src/shared/cleanup-limits'

describe('cleanup confirmation store', () => {
  beforeEach(() => {
    clearCleanupConfirmationStoreForTests()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates single-use confirmation tokens', () => {
    const entry = createCleanupConfirmation({
      sessionId: 'session-1',
      fingerprint: 'fp-1',
      revision: 0,
      candidateIds: ['c1', 'c2']
    })
    expect(peekCleanupConfirmation(entry.confirmationId)?.candidateIds).toEqual(['c1', 'c2'])
    const consumed = consumeCleanupConfirmation(entry.confirmationId)
    expect(consumed.candidateIds).toEqual(['c1', 'c2'])
    expect(getCleanupPendingStoreSizeForTests()).toBe(0)
    expect(getCleanupTombstoneStoreSizeForTests()).toBe(1)
    expect(() => consumeCleanupConfirmation(entry.confirmationId)).toThrow('CONFIRMATION_ALREADY_USED')
  })

  it('expires confirmation tokens', () => {
    const entry = createCleanupConfirmation({
      sessionId: 'session-1',
      fingerprint: 'fp-1',
      revision: 0,
      candidateIds: ['c1']
    })
    vi.advanceTimersByTime(CLEANUP_CONFIRMATION_TTL_MS + 1)
    expect(() => consumeCleanupConfirmation(entry.confirmationId)).toThrow('CONFIRMATION_EXPIRED')
  })

  it('uses short ttl window', () => {
    expect(CLEANUP_CONFIRMATION_TTL_MS).toBeLessThanOrEqual(10 * 60 * 1000)
    expect(CLEANUP_CONFIRMATION_TOMBSTONE_TTL_MS).toBeGreaterThan(CLEANUP_CONFIRMATION_TTL_MS)
  })

  it('prunes tombstones after ttl and enforces global cap', () => {
    for (let i = 0; i < 20; i++) {
      const entry = createCleanupConfirmation({
        sessionId: `session-${i}`,
        fingerprint: `fp-${i}`,
        revision: 0,
        candidateIds: ['c1']
      })
      consumeCleanupConfirmation(entry.confirmationId)
    }
    expect(getCleanupConfirmationStoreSizeForTests()).toBeLessThanOrEqual(
      MAX_CLEANUP_CONFIRMATION_STORE_ENTRIES
    )
    vi.advanceTimersByTime(CLEANUP_CONFIRMATION_TOMBSTONE_TTL_MS + 1)
    createCleanupConfirmation({
      sessionId: 'fresh',
      fingerprint: 'fp-fresh',
      revision: 0,
      candidateIds: ['c1']
    })
    expect(getCleanupTombstoneStoreSizeForTests()).toBe(0)
  })

  it('keeps newly created confirmation when store is full of tombstones', () => {
    const base = Date.now()
    for (let i = 0; i < MAX_CLEANUP_CONFIRMATION_STORE_ENTRIES; i++) {
      seedConsumedTombstoneForTests({
        confirmationId: `tomb-${i}`,
        sessionId: `session-${i}`,
        consumedAt: base + i
      })
    }
    expect(getCleanupConfirmationStoreSizeForTests()).toBe(MAX_CLEANUP_CONFIRMATION_STORE_ENTRIES)

    const entry = createCleanupConfirmation({
      sessionId: 'fresh-session',
      fingerprint: 'fp-fresh',
      revision: 0,
      candidateIds: ['c1']
    })

    expect(peekCleanupConfirmation(entry.confirmationId)?.candidateIds).toEqual(['c1'])
    const consumed = consumeCleanupConfirmation(entry.confirmationId)
    expect(consumed.confirmationId).toBe(entry.confirmationId)
    expect(getCleanupConfirmationStoreSizeForTests()).toBeLessThanOrEqual(
      MAX_CLEANUP_CONFIRMATION_STORE_ENTRIES
    )
    expect(getCleanupTombstoneStoreSizeForTests()).toBe(MAX_CLEANUP_CONFIRMATION_STORE_ENTRIES)
  })

  it('does not delete the new token when many pending and tombstones are mixed', () => {
    const base = Date.now()
    for (let i = 0; i < 120; i++) {
      seedConsumedTombstoneForTests({
        confirmationId: `mixed-tomb-${i}`,
        sessionId: `session-${i}`,
        consumedAt: base + i
      })
    }
    for (let i = 0; i < 79; i++) {
      createCleanupConfirmation({
        sessionId: `pending-session-${i}`,
        fingerprint: `fp-${i}`,
        revision: 0,
        candidateIds: ['c1']
      })
    }
    expect(getCleanupConfirmationStoreSizeForTests()).toBe(199)

    const entry = createCleanupConfirmation({
      sessionId: 'latest-session',
      fingerprint: 'fp-latest',
      revision: 0,
      candidateIds: ['c-latest']
    })
    expect(peekCleanupConfirmation(entry.confirmationId)?.candidateIds).toEqual(['c-latest'])
    expect(consumeCleanupConfirmation(entry.confirmationId).confirmationId).toBe(entry.confirmationId)
  })

  it('releases capacity after tombstone ttl expires', () => {
    for (let i = 0; i < MAX_CLEANUP_CONFIRMATION_STORE_ENTRIES; i++) {
      seedConsumedTombstoneForTests({
        confirmationId: `ttl-tomb-${i}`,
        sessionId: `session-${i}`,
        consumedAt: Date.now()
      })
    }
    vi.advanceTimersByTime(CLEANUP_CONFIRMATION_TOMBSTONE_TTL_MS + 1)
    const entry = createCleanupConfirmation({
      sessionId: 'after-ttl',
      fingerprint: 'fp-after-ttl',
      revision: 0,
      candidateIds: ['c1']
    })
    expect(peekCleanupConfirmation(entry.confirmationId)).not.toBeNull()
    expect(getCleanupTombstoneStoreSizeForTests()).toBe(0)
  })
})

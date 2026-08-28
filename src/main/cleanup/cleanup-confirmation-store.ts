import { randomUUID } from 'crypto'
import {
  CLEANUP_CONFIRMATION_TOMBSTONE_TTL_MS,
  CLEANUP_CONFIRMATION_TTL_MS,
  MAX_CLEANUP_CONFIRMATION_STORE_ENTRIES,
  MAX_CONFIRMATION_ID_LENGTH,
  MAX_FINGERPRINT_LENGTH,
  MAX_SESSION_ID_LENGTH
} from '../../shared/cleanup-limits'

export interface PendingCleanupConfirmation {
  confirmationId: string
  sessionId: string
  fingerprint: string
  revision: number
  candidateIds: string[]
  createdAt: number
  expiresAt: number
}

interface ConsumedCleanupTombstone {
  confirmationId: string
  sessionId: string
  consumedAt: number
  expiresAt: number
}

const pendingById = new Map<string, PendingCleanupConfirmation>()
const tombstonesById = new Map<string, ConsumedCleanupTombstone>()

function assertBoundedId(value: string, label: string, maxLength: number): void {
  if (!value.trim() || value.length > maxLength) {
    throw new Error('INVALID_INPUT')
  }
}

function pruneExpiredEntries(now = Date.now()): void {
  for (const [id, entry] of pendingById.entries()) {
    if (entry.expiresAt <= now) {
      pendingById.delete(id)
    }
  }
  for (const [id, tombstone] of tombstonesById.entries()) {
    if (tombstone.expiresAt <= now) {
      tombstonesById.delete(id)
    }
  }
}

function deleteOldestTombstone(): boolean {
  const oldest = [...tombstonesById.entries()].sort((a, b) => a[1].consumedAt - b[1].consumedAt)[0]
  if (!oldest) return false
  tombstonesById.delete(oldest[0])
  return true
}

function deleteOldestPending(exceptConfirmationId?: string): boolean {
  const candidates = [...pendingById.entries()]
    .filter(([id]) => id !== exceptConfirmationId)
    .sort((a, b) => a[1].createdAt - b[1].createdAt)
  const oldest = candidates[0]
  if (!oldest) return false
  pendingById.delete(oldest[0])
  return true
}

function enforceGlobalLimit(preserveConfirmationId?: string): void {
  pruneExpiredEntries()
  while (pendingById.size + tombstonesById.size > MAX_CLEANUP_CONFIRMATION_STORE_ENTRIES) {
    if (deleteOldestTombstone()) continue
    if (deleteOldestPending(preserveConfirmationId)) continue
    throw new Error('CONFIRMATION_STORE_FULL')
  }
}

export function invalidateCleanupConfirmationsForSession(sessionId?: string): void {
  if (!sessionId) {
    pendingById.clear()
    tombstonesById.clear()
    return
  }
  for (const [id, entry] of pendingById.entries()) {
    if (entry.sessionId === sessionId) {
      pendingById.delete(id)
    }
  }
}

export function invalidateCleanupConfirmationsCompletely(sessionId?: string): void {
  if (!sessionId) {
    pendingById.clear()
    tombstonesById.clear()
    return
  }
  invalidateCleanupConfirmationsForSession(sessionId)
  for (const [id, tombstone] of tombstonesById.entries()) {
    if (tombstone.sessionId === sessionId) {
      tombstonesById.delete(id)
    }
  }
}

export function invalidateCleanupConfirmationsExceptFingerprint(
  sessionId: string,
  fingerprint: string
): void {
  for (const [id, entry] of pendingById.entries()) {
    if (entry.sessionId === sessionId && entry.fingerprint !== fingerprint) {
      pendingById.delete(id)
    }
  }
}

export function createCleanupConfirmation(input: {
  sessionId: string
  fingerprint: string
  revision: number
  candidateIds: string[]
}): PendingCleanupConfirmation {
  assertBoundedId(input.sessionId, 'sessionId', MAX_SESSION_ID_LENGTH)
  assertBoundedId(input.fingerprint, 'fingerprint', MAX_FINGERPRINT_LENGTH)
  pruneExpiredEntries()
  invalidateCleanupConfirmationsForSession(input.sessionId)
  const now = Date.now()
  const entry: PendingCleanupConfirmation = {
    confirmationId: randomUUID(),
    sessionId: input.sessionId,
    fingerprint: input.fingerprint,
    revision: input.revision,
    candidateIds: [...input.candidateIds],
    createdAt: now,
    expiresAt: now + CLEANUP_CONFIRMATION_TTL_MS
  }
  assertBoundedId(entry.confirmationId, 'confirmationId', MAX_CONFIRMATION_ID_LENGTH)
  pendingById.set(entry.confirmationId, entry)
  enforceGlobalLimit(entry.confirmationId)
  if (!pendingById.has(entry.confirmationId)) {
    throw new Error('CONFIRMATION_STORE_FULL')
  }
  return entry
}

export function peekCleanupConfirmation(confirmationId: string): PendingCleanupConfirmation | null {
  assertBoundedId(confirmationId, 'confirmationId', MAX_CONFIRMATION_ID_LENGTH)
  pruneExpiredEntries()
  const entry = pendingById.get(confirmationId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    pendingById.delete(confirmationId)
    return null
  }
  return entry
}

export function consumeCleanupConfirmation(confirmationId: string): PendingCleanupConfirmation {
  assertBoundedId(confirmationId, 'confirmationId', MAX_CONFIRMATION_ID_LENGTH)
  const tombstone = tombstonesById.get(confirmationId)
  if (tombstone) {
    throw new Error('CONFIRMATION_ALREADY_USED')
  }
  const entry = pendingById.get(confirmationId)
  if (!entry) {
    throw new Error('CONFIRMATION_NOT_FOUND')
  }
  if (Date.now() > entry.expiresAt) {
    pendingById.delete(confirmationId)
    throw new Error('CONFIRMATION_EXPIRED')
  }
  pendingById.delete(confirmationId)
  const now = Date.now()
  tombstonesById.set(confirmationId, {
    confirmationId,
    sessionId: entry.sessionId,
    consumedAt: now,
    expiresAt: now + CLEANUP_CONFIRMATION_TOMBSTONE_TTL_MS
  })
  enforceGlobalLimit()
  return entry
}

export function clearCleanupConfirmationStoreForTests(): void {
  pendingById.clear()
  tombstonesById.clear()
}

export function getCleanupConfirmationStoreSizeForTests(): number {
  return pendingById.size + tombstonesById.size
}

export function getCleanupPendingStoreSizeForTests(): number {
  return pendingById.size
}

export function getCleanupTombstoneStoreSizeForTests(): number {
  return tombstonesById.size
}

export function seedConsumedTombstoneForTests(input: {
  confirmationId: string
  sessionId: string
  consumedAt?: number
  expiresAt?: number
}): void {
  const consumedAt = input.consumedAt ?? Date.now()
  tombstonesById.set(input.confirmationId, {
    confirmationId: input.confirmationId,
    sessionId: input.sessionId,
    consumedAt,
    expiresAt: input.expiresAt ?? consumedAt + CLEANUP_CONFIRMATION_TOMBSTONE_TTL_MS
  })
}

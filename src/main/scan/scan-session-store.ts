import { randomUUID } from 'crypto'
import type { ScanCandidate, ScanMode } from '../../shared/types'
import { invalidateCleanupConfirmationsForSession } from '../cleanup/cleanup-confirmation-store'

const SESSION_TTL_MS = 30 * 60 * 1000

export const SCAN_SESSION_TTL_MS = SESSION_TTL_MS

export interface ScanSession {
  sessionId: string
  createdAt: number
  expiresAt: number
  revision: number
  drive: string
  mode: ScanMode
  rulesVersion: string
  candidates: Map<string, ScanCandidate>
}

let activeSession: ScanSession | null = null

export function createScanSession(
  drive: string,
  mode: ScanMode,
  rulesVersion: string,
  candidates: ScanCandidate[]
): ScanSession {
  const session: ScanSession = {
    sessionId: randomUUID(),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    revision: 0,
    drive,
    mode,
    rulesVersion,
    candidates: new Map(candidates.map((c) => [c.id, c]))
  }
  invalidateCleanupConfirmationsForSession()
  activeSession = session
  return session
}

export function getScanSession(sessionId: string): ScanSession | null {
  if (!activeSession || activeSession.sessionId !== sessionId) return null
  if (Date.now() > activeSession.expiresAt) {
    activeSession = null
    return null
  }
  return activeSession
}

export function getActiveScanSessionInfo(): {
  sessionId: string
  fingerprint: string
  drive: string
  candidateCount: number
  revision: number
} | null {
  if (!activeSession || Date.now() > activeSession.expiresAt) {
    activeSession = null
    return null
  }
  return {
    sessionId: activeSession.sessionId,
    fingerprint: `${activeSession.sessionId}:${activeSession.createdAt}:${activeSession.revision}`,
    drive: activeSession.drive,
    candidateCount: activeSession.candidates.size,
    revision: activeSession.revision
  }
}

export function clearScanSession(): void {
  invalidateCleanupConfirmationsForSession()
  activeSession = null
}

export function updateScanSessionCandidates(sessionId: string, candidates: ScanCandidate[]): boolean {
  if (!activeSession || activeSession.sessionId !== sessionId) return false
  if (Date.now() > activeSession.expiresAt) {
    activeSession = null
    return false
  }
  activeSession.candidates = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  activeSession.revision += 1
  invalidateCleanupConfirmationsForSession(sessionId)
  return true
}

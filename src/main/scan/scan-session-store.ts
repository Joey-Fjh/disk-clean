import { randomUUID } from 'crypto'
import type { ScanCandidate, ScanMode } from '../../shared/types'

const SESSION_TTL_MS = 30 * 60 * 1000

export const SCAN_SESSION_TTL_MS = SESSION_TTL_MS

export interface ScanSession {
  sessionId: string
  createdAt: number
  expiresAt: number
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
    drive,
    mode,
    rulesVersion,
    candidates: new Map(candidates.map((c) => [c.id, c]))
  }
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

export function clearScanSession(): void {
  activeSession = null
}

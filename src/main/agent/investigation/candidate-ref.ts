import type { ScanSession } from '../../scan/scan-session-store'
import type { ScanCandidate } from '../../../shared/types'
import {
  buildCandidateRefIndex,
  buildSessionFingerprint,
  type CandidateRefIndex
} from '../../../shared/candidate-ref-index'
import { InvestigationError } from './investigation-errors'

import { INVESTIGATION_LIMITS } from '../../../shared/investigation-limits'

const registeredRefMaps = new Map<string, Map<string, string>>()

export function registerCandidateRefMap(fingerprint: string, refToId: Map<string, string>): void {
  registeredRefMaps.set(fingerprint, refToId)
  while (registeredRefMaps.size > INVESTIGATION_LIMITS.MAX_TERMINAL_HISTORY_ENTRIES) {
    const oldest = registeredRefMaps.keys().next().value
    if (!oldest) break
    registeredRefMaps.delete(oldest)
  }
}

export function clearCandidateRefMaps(): void {
  registeredRefMaps.clear()
}

export function releaseCandidateRefMap(fingerprint: string): void {
  registeredRefMaps.delete(fingerprint)
}

export function clearCandidateRefMapsForSession(sessionId: string): void {
  for (const key of [...registeredRefMaps.keys()]) {
    if (key.startsWith(`${sessionId}:`)) {
      registeredRefMaps.delete(key)
    }
  }
}

export function getRegisteredRefMap(fingerprint: string): Map<string, string> | undefined {
  return registeredRefMaps.get(fingerprint)
}

export function buildSessionCandidateRefIndex(session: ScanSession): CandidateRefIndex {
  const items = [...session.candidates.values()]
  const fingerprint = buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)
  return buildCandidateRefIndex(items, fingerprint, session.revision)
}

export function buildCandidateRefMap(session: ScanSession): Map<string, string> {
  return buildSessionCandidateRefIndex(session).refToId
}

export function resolveCandidateByRef(
  session: ScanSession,
  candidateRef: string,
  fingerprint?: string
): ScanCandidate {
  const trimmed = candidateRef.trim()
  if (!trimmed) {
    throw new InvestigationError('CANDIDATE_NOT_FOUND', '候选引用无效')
  }
  const fp =
    fingerprint ?? buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)
  const refToId = registeredRefMaps.get(fp) ?? buildCandidateRefMap(session)
  const candidateId = refToId.get(trimmed)
  if (!candidateId) {
    throw new InvestigationError('CANDIDATE_NOT_FOUND', '候选引用无效')
  }
  const candidate = session.candidates.get(candidateId)
  if (!candidate) {
    throw new InvestigationError('CANDIDATE_NOT_FOUND', '候选引用无效')
  }
  return candidate
}

export function resolveCandidateIdByRef(
  session: ScanSession,
  candidateRef: string,
  fingerprint?: string
): string {
  return resolveCandidateByRef(session, candidateRef, fingerprint).id
}

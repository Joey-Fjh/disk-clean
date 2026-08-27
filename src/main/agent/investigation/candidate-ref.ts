import type { ScanSession } from '../../scan/scan-session-store'
import type { ScanCandidate } from '../../../shared/types'
import { InvestigationError } from './investigation-errors'

export function buildCandidateRefMap(session: ScanSession): Map<string, string> {
  const refs = new Map<string, string>()
  const items = [...session.candidates.values()]
  items.forEach((item, index) => {
    refs.set(`candidate-${index + 1}`, item.id)
  })
  return refs
}

export function resolveCandidateByRef(session: ScanSession, candidateRef: string): ScanCandidate {
  const trimmed = candidateRef.trim()
  if (!trimmed) {
    throw new InvestigationError('CANDIDATE_NOT_FOUND', '候选引用无效')
  }
  const refToId = buildCandidateRefMap(session)
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

export function resolveCandidateIdByRef(session: ScanSession, candidateRef: string): string {
  return resolveCandidateByRef(session, candidateRef).id
}

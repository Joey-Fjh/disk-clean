import type { ScanItem } from './types'

/** 单一稳定的 candidateRef 索引：同一 session + revision 内 ref 与 id 一一对应。 */
export interface CandidateRefIndex {
  fingerprint: string
  revision: number
  refToId: Map<string, string>
  idToRef: Map<string, string>
  orderedItems: ScanItem[]
}

export function buildSessionFingerprint(
  sessionId: string,
  createdAt: number,
  revision: number
): string {
  return `${sessionId}:${createdAt}:${revision}`
}

export function buildCandidateRefIndex(
  items: ScanItem[],
  fingerprint: string,
  revision: number
): CandidateRefIndex {
  const refToId = new Map<string, string>()
  const idToRef = new Map<string, string>()
  items.forEach((item, index) => {
    const candidateRef = `candidate-${index + 1}`
    refToId.set(candidateRef, item.id)
    idToRef.set(item.id, candidateRef)
  })
  return {
    fingerprint,
    revision,
    refToId,
    idToRef,
    orderedItems: items
  }
}

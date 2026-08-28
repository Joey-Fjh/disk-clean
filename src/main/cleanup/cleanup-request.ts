import { MAX_CANDIDATE_ID_LENGTH, MAX_CLEANUP_CANDIDATE_IDS } from '../../shared/cleanup-limits'

export function normalizeCleanupCandidateIds(candidateIds: string[]): {
  uniqueIds: string[]
  preRejected: Array<{ path: string; reason: string }>
} {
  const preRejected: Array<{ path: string; reason: string }> = []
  const seen = new Set<string>()
  const uniqueIds: string[] = []

  if (candidateIds.length > MAX_CLEANUP_CANDIDATE_IDS) {
    preRejected.push({
      path: '(batch)',
      reason: `候选项数量超过上限 ${MAX_CLEANUP_CANDIDATE_IDS}`
    })
    return { uniqueIds: [], preRejected }
  }

  for (const rawId of candidateIds) {
    if (typeof rawId !== 'string' || !rawId.trim()) {
      preRejected.push({ path: '(invalid)', reason: '无效的候选项 ID' })
      continue
    }
    if (rawId.length > MAX_CANDIDATE_ID_LENGTH) {
      preRejected.push({ path: rawId.slice(0, 64), reason: '候选项 ID 过长' })
      continue
    }
    if (seen.has(rawId)) {
      preRejected.push({ path: rawId, reason: '重复的候选项 ID' })
      continue
    }
    seen.add(rawId)
    uniqueIds.push(rawId)
  }

  return { uniqueIds, preRejected }
}

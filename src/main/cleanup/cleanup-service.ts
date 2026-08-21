import type { CleanupRequest, CleanupResult } from '../../shared/types'
import { MAX_CANDIDATE_ID_LENGTH, MAX_CLEANUP_CANDIDATE_IDS } from '../../shared/cleanup-limits'
import { buildCleanupPlan } from './plan-builder'
import { validateCleanupActions } from './safety-validator'
import { executeCleanup } from './cleaner'
import { getScanSession } from '../scan/scan-session-store'

function emptyResult(skipped: number, rejected: Array<{ path: string; reason: string }>): CleanupResult {
  return {
    planId: '',
    estimatedLogicalBytes: 0,
    movedToTrashBytes: 0,
    actuallyReclaimedBytes: 0,
    reclaimState: 'unknown',
    recoveryMode: 'recycle-bin',
    moved: 0,
    skipped,
    failed: 0,
    succeeded: [],
    errors: [],
    rejected
  }
}

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

export async function runCleanup(request: CleanupRequest): Promise<CleanupResult> {
  const session = getScanSession(request.sessionId)
  const { uniqueIds, preRejected } = normalizeCleanupCandidateIds(request.candidateIds)

  if (!session) {
    const rejected = [
      ...preRejected,
      ...uniqueIds.map((id) => ({ path: id, reason: '扫描会话已过期或无效' }))
    ]
    return emptyResult(rejected.length, rejected)
  }

  const candidates = []
  for (const id of uniqueIds) {
    const candidate = session.candidates.get(id)
    if (!candidate) {
      preRejected.push({ path: id, reason: '候选项不属于当前扫描会话' })
      continue
    }
    candidates.push(candidate)
  }

  const plan = buildCleanupPlan(request.sessionId, candidates)
  const { approved, rejected } = await validateCleanupActions(request.sessionId, plan.actions)
  const allRejected = [...preRejected, ...rejected]
  return executeCleanup(plan.id, approved, allRejected)
}

import { randomUUID } from 'crypto'
import type { Category, CleanupAction, CleanupPlan, ScanCandidate } from '../../shared/types'
import type { CleanupAuthorizationSource } from '../../shared/session-cleanup-authorization'

export interface BuiltCleanupPlan {
  plan: CleanupPlan
  actions: CleanupAction[]
  candidates: ScanCandidate[]
  authorizationByCandidateId: Map<string, CleanupAuthorizationSource>
}

export function buildCleanupPlanFromCandidates(candidates: ScanCandidate[]): BuiltCleanupPlan {
  const actions: CleanupAction[] = candidates.map((item) => ({
    candidateId: item.id,
    ruleId: item.ruleId,
    target: item.path,
    operation: 'trash',
    estimatedLogicalBytes: item.size
  }))

  const riskSummary: Record<Category, number> = {
    safe: 0,
    recommended: 0,
    dangerous: 0
  }
  for (const item of candidates) {
    riskSummary[item.category] += 1
  }

  return {
    plan: {
      id: randomUUID(),
      actions,
      estimatedLogicalBytes: actions.reduce((sum, action) => sum + action.estimatedLogicalBytes, 0),
      riskSummary,
      createdAt: Date.now()
    },
    actions,
    candidates,
    authorizationByCandidateId: new Map()
  }
}

/** @deprecated Use buildCleanupPlanFromCandidates via cleanup-service prepare flow. */
export function buildCleanupPlan(_sessionId: string, candidates: ScanCandidate[]): CleanupPlan {
  return buildCleanupPlanFromCandidates(candidates).plan
}

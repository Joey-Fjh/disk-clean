import { randomUUID } from 'crypto'
import type { Category, CleanupAction, CleanupPlan, ScanCandidate } from '../../shared/types'

export function buildCleanupPlan(_sessionId: string, candidates: ScanCandidate[]): CleanupPlan {
  const actions: CleanupAction[] = candidates
    .filter((item) => item.deletable)
    .map((item) => ({
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
    if (item.deletable) riskSummary[item.category]++
  }

  return {
    id: randomUUID(),
    actions,
    estimatedLogicalBytes: actions.reduce((sum, action) => sum + action.estimatedLogicalBytes, 0),
    riskSummary,
    createdAt: Date.now()
  }
}

import { randomUUID } from 'crypto'
import type { Category, CleanupAction, CleanupPlan, CleanupRequestItem } from '../../shared/types'

export function buildCleanupPlan(items: CleanupRequestItem[]): CleanupPlan {
  const actions: CleanupAction[] = items
    .filter((item) => item.deletable)
    .map((item) => ({
      candidateId: item.id,
      ruleId: item.ruleId,
      target: item.path,
      operation: 'trash',
      estimatedBytes: item.size
    }))

  const riskSummary: Record<Category, number> = {
    safe: 0,
    recommended: 0,
    dangerous: 0
  }
  for (const item of items) {
    if (item.deletable) riskSummary[item.category]++
  }

  return {
    id: randomUUID(),
    actions,
    estimatedBytes: actions.reduce((sum, action) => sum + action.estimatedBytes, 0),
    riskSummary,
    createdAt: Date.now()
  }
}

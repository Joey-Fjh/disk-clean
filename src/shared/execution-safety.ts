import type { ScanItem, LocalExecutionSafety } from './types'

export type { LocalExecutionSafety } from './types'

function isRuleBackedCandidate(item: ScanItem): boolean {
  return item.discoverySources?.includes('rule') ?? item.source === 'rule'
}

export function isPolicyBlockedImpact(impact?: string): boolean {
  const text = impact ?? ''
  return text.includes('不提供普通删除授权') || text.includes('禁止清理')
}

export function resolveExecutionSafety(item: ScanItem, protectedPath = false): LocalExecutionSafety {
  if (item.executionSafety === 'agent-confirmable' || item.executionSafety === 'rule-eligible') {
    return item.executionSafety
  }
  if (protectedPath || item.judgment?.judgmentOrigin === 'protected-policy') {
    return 'policy-blocked'
  }
  if (isPolicyBlockedImpact(item.impact) || item.contentType === 'system-protected') {
    return 'policy-blocked'
  }
  if (isRuleBackedCandidate(item)) {
    if (item.category === 'dangerous' || !item.snapshotComplete) {
      return 'advice-only'
    }
    return 'rule-eligible'
  }
  if (item.executionSafety === 'policy-blocked' || item.executionSafety === 'advice-only') {
    return item.executionSafety
  }
  return 'advice-only'
}

/** 将空间扫描项提升为可由 Agent 会话申请清理授权（调查队列选中时调用）。 */
export function markCandidateAgentConfirmable(item: ScanItem): ScanItem {
  const safety = resolveExecutionSafety(item, false)
  if (safety === 'policy-blocked') return item
  if (isRuleBackedCandidate(item)) return item
  return { ...item, executionSafety: 'agent-confirmable' }
}

export function canAgentSessionAuthorizeCleanup(item: ScanItem): boolean {
  return item.snapshotComplete === true && item.executionSafety === 'agent-confirmable'
}

export function hasRuleExecutionEligibility(item: ScanItem): boolean {
  return isRuleBackedCandidate(item) && item.executionSafety === 'rule-eligible'
}

export function isExecutionPermanentlyBlocked(item: ScanItem): boolean {
  return item.executionSafety === 'policy-blocked'
}

export function isAdviceOnlyExecution(item: ScanItem): boolean {
  return item.executionSafety === 'advice-only' || item.executionSafety === 'policy-blocked'
}

import type { AgentVerdict } from './agent-types'
import {
  canAgentSessionAuthorizeCleanup,
  resolveExecutionSafety
} from './execution-safety'
export {
  canAgentSessionAuthorizeCleanup,
  markCandidateAgentConfirmable,
  resolveExecutionSafety,
  hasRuleExecutionEligibility,
  isAdviceOnlyExecution,
  isExecutionPermanentlyBlocked
} from './execution-safety'
import type {
  CandidateJudgment,
  ConfidenceLevel,
  JudgmentOrigin,
  JudgmentStatus,
  ScanItem
} from './types'

export const JUDGMENT_ORIGIN_LABELS: Record<JudgmentOrigin, string> = {
  'local-rule': '本地规则',
  'local-rule-agent-reviewed': '本地规则 + Agent',
  'agent-advice-only': 'Agent 建议（未获清理授权）',
  'agent-session': 'Agent 会话授权',
  'space-evidence-only': '仅空间发现',
  'protected-policy': '安全策略保护',
  'user-experience': '用户经验'
}

export function isRuleBackedCandidate(item: ScanItem): boolean {
  return item.discoverySources?.includes('rule') ?? item.source === 'rule'
}

export function isSpaceOnlyCandidate(item: ScanItem): boolean {
  return (item.discoverySources?.includes('space-scan') ?? false) && !isRuleBackedCandidate(item)
}

export function hasLocalCleanupAuthorization(item: ScanItem): boolean {
  if (!isRuleBackedCandidate(item)) return false
  if (!item.snapshotComplete) return false
  return item.executionSafety === 'rule-eligible'
}

function verdictToStatus(verdict: AgentVerdict): JudgmentStatus {
  if (verdict === 'clean') return 'suggested'
  if (verdict === 'confirm') return 'caution'
  if (verdict === 'keep') return 'keep'
  return 'uncertain'
}

export function resolveLocalJudgment(item: ScanItem, protectedPath: boolean): CandidateJudgment {
  if (protectedPath) {
    return {
      status: 'uncertain',
      source: 'local-policy',
      confidence: 'high',
      basis: ['系统或程序目录：仅统计空间占用，不提供普通删除授权'],
      judgmentOrigin: 'protected-policy'
    }
  }

  if (isRuleBackedCandidate(item)) {
    const status: JudgmentStatus =
      item.category === 'safe'
        ? 'suggested'
        : item.category === 'recommended'
          ? 'caution'
          : 'keep'
    return {
      status,
      source: 'legacy-rule',
      confidence: status === 'suggested' ? 'high' : status === 'caution' ? 'medium' : 'unknown',
      basis: [`命中规则：${item.ruleName}`, item.reason ?? item.description ?? '规则定义项'].filter(
        Boolean
      ),
      judgmentOrigin: 'local-rule'
    }
  }

  return {
    status: 'uncertain',
    source: 'none',
    confidence: 'unknown',
    basis: [item.reason ?? '空间扫描发现占用，尚未获得清理授权'],
    judgmentOrigin: 'space-evidence-only'
  }
}

export interface AgentReviewInput {
  verdict: AgentVerdict
  confidence: ConfidenceLevel
  basis: string[]
}

export function mergeAgentReviewIntoJudgment(
  item: ScanItem,
  localJudgment: CandidateJudgment,
  agent: AgentReviewInput | null,
  protectedPath: boolean
): CandidateJudgment {
  if (protectedPath) {
    return {
      status: 'uncertain',
      source: 'local-policy',
      confidence: 'high',
      basis: ['系统或程序目录：仅统计空间占用，不提供普通删除授权'],
      judgmentOrigin: 'protected-policy',
      agentVerdict: agent?.verdict
    }
  }

  if (!agent) {
    return localJudgment
  }

  const agentStatus = verdictToStatus(agent.verdict)
  const locallyAuthorized = hasLocalCleanupAuthorization(item)

  if (!locallyAuthorized) {
    if (agent.verdict === 'clean' || agent.verdict === 'confirm') {
      if (canAgentSessionAuthorizeCleanup(item)) {
        return {
          status: agentStatus === 'suggested' ? 'caution' : agentStatus,
          source: 'agent',
          confidence: agent.confidence,
          basis: agent.basis,
          judgmentOrigin: 'agent-session',
          agentVerdict: agent.verdict
        }
      }
      return {
        status: agentStatus === 'suggested' ? 'caution' : agentStatus,
        source: 'agent',
        confidence: agent.confidence,
        basis: agent.basis,
        judgmentOrigin: 'agent-advice-only',
        agentVerdict: agent.verdict
      }
    }
    return {
      status: agentStatus === 'suggested' ? 'caution' : agentStatus,
      source: 'agent',
      confidence: agent.confidence,
      basis: agent.basis,
      judgmentOrigin: 'agent-advice-only',
      agentVerdict: agent.verdict
    }
  }

  if (agent.verdict === 'keep') {
    return {
      status: 'keep',
      source: 'agent',
      confidence: agent.confidence,
      basis: agent.basis,
      judgmentOrigin: 'local-rule-agent-reviewed',
      agentVerdict: agent.verdict
    }
  }

  if (agent.verdict === 'uncertain') {
    return {
      status: 'caution',
      source: 'agent',
      confidence: agent.confidence,
      basis: agent.basis,
      judgmentOrigin: 'local-rule-agent-reviewed',
      agentVerdict: agent.verdict
    }
  }

  return {
    status: agentStatus,
    source: 'agent',
    confidence: agent.confidence,
    basis: agent.basis,
    judgmentOrigin: 'local-rule-agent-reviewed',
    agentVerdict: agent.verdict
  }
}

export function isAgentDowngrade(judgment: CandidateJudgment, localJudgment: CandidateJudgment): boolean {
  const rank: Record<JudgmentStatus, number> = {
    identifying: 0,
    pending: 0,
    suggested: 4,
    caution: 3,
    uncertain: 2,
    keep: 1
  }
  return rank[judgment.status] < rank[localJudgment.status]
}

export function shouldClearSelectionAfterAgent(
  item: ScanItem,
  judgment: CandidateJudgment,
  localJudgment: CandidateJudgment
): boolean {
  if (judgment.status === 'keep') return true
  if (judgment.judgmentOrigin === 'agent-advice-only') return true
  if (judgment.judgmentOrigin === 'agent-session') return false
  if (isAgentDowngrade(judgment, localJudgment) && judgment.status !== 'suggested') return true
  if (!hasLocalCleanupAuthorization(item) && judgment.source === 'agent') return true
  return false
}

export function finalizeLocalScanItem(item: ScanItem, protectedPath: boolean): ScanItem {
  const judgment = resolveLocalJudgment(item, protectedPath)
  const executionSafety = resolveExecutionSafety({ ...item, judgment }, protectedPath)
  return {
    ...item,
    judgment,
    executionSafety
  }
}

export function getJudgmentOriginLabel(origin?: JudgmentOrigin): string | undefined {
  if (!origin) return undefined
  return JUDGMENT_ORIGIN_LABELS[origin]
}

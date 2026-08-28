import type { AgentVerdict } from './agent-types'
import { hasLocalCleanupAuthorization, isRuleBackedCandidate, isSpaceOnlyCandidate, canAgentSessionAuthorizeCleanup } from './candidate-judgment'
import { isRuleOrdinaryDeletable } from './rule-enforcement'
import type { CleanupErrorCode } from './cleanup-errors'
import type { RuleWithMeta, ScanItem } from './types'

export type CleanupAuthorizationSource = 'agent-session' | 'local-rule' | 'protected-policy' | 'none'

export interface SessionCleanupAuthEvaluation {
  authorized: boolean
  source: CleanupAuthorizationSource
  code?: CleanupErrorCode
  message?: string
}

export interface SessionCleanupAuthContext {
  candidate: ScanItem
  rule?: Pick<
    RuleWithMeta,
    'id' | 'enabled' | 'cleanupMethod' | 'reviewStatus' | 'deletable' | 'category' | 'nativeManaged'
  > | null
  protectedPath: boolean
}

function agentVerdict(candidate: ScanItem): AgentVerdict | undefined {
  return candidate.judgment?.agentVerdict
}

function isExplicitAgentCleanupVerdict(verdict: AgentVerdict | undefined): verdict is 'clean' | 'confirm' {
  return verdict === 'clean' || verdict === 'confirm'
}

export function evaluateSessionCleanupAuthorization(
  context: SessionCleanupAuthContext
): SessionCleanupAuthEvaluation {
  const { candidate, rule, protectedPath } = context
  const judgment = candidate.judgment ?? {
    status: 'uncertain' as const,
    source: 'none' as const,
    confidence: 'unknown' as const,
    basis: []
  }
  const verdict = agentVerdict(candidate)

  if (protectedPath || judgment.judgmentOrigin === 'protected-policy') {
    return {
      authorized: false,
      source: 'protected-policy',
      code: 'PROTECTED_PATH',
      message: '系统或程序目录不提供普通删除授权'
    }
  }

  if (candidate.executionSafety === 'policy-blocked') {
    return {
      authorized: false,
      source: 'protected-policy',
      code: 'PROTECTED_PATH',
      message: '系统或程序目录不提供普通删除授权'
    }
  }

  if (candidate.executionSafety === 'advice-only' && isExplicitAgentCleanupVerdict(verdict)) {
    return {
      authorized: false,
      source: 'none',
      code: 'NOT_AUTHORIZED',
      message: '候选项尚未进入 Agent 调查队列，无法申请会话清理授权'
    }
  }

  if (judgment.status === 'keep' || verdict === 'keep') {
    return {
      authorized: false,
      source: 'none',
      code: 'NOT_AUTHORIZED',
      message: 'Agent 建议保留'
    }
  }

  if (judgment.status === 'uncertain' || verdict === 'uncertain') {
    return {
      authorized: false,
      source: 'none',
      code: 'NOT_AUTHORIZED',
      message: '信息不足，无法确定是否可清理'
    }
  }

  if (!candidate.snapshotComplete) {
    return {
      authorized: false,
      source: 'none',
      code: 'SNAPSHOT_STALE',
      message: '扫描快照不完整'
    }
  }

  const localRuleEligible =
    isRuleBackedCandidate(candidate) &&
    hasLocalCleanupAuthorization(candidate) &&
    Boolean(rule?.enabled)

  if (localRuleEligible) {
    if (!isRuleOrdinaryDeletable(rule!)) {
      return {
        authorized: false,
        source: 'none',
        code: 'ACTION_NOT_ALLOWED',
        message: '该规则项不允许删除'
      }
    }
    return { authorized: true, source: 'local-rule' }
  }

  if (isSpaceOnlyCandidate(candidate) && !isExplicitAgentCleanupVerdict(verdict)) {
    return {
      authorized: false,
      source: 'none',
      code: 'NOT_AUTHORIZED',
      message: '仅空间发现，尚未获得清理授权'
    }
  }

  if (isExplicitAgentCleanupVerdict(verdict)) {
    if (!canAgentSessionAuthorizeCleanup(candidate)) {
      return {
        authorized: false,
        source: 'none',
        code: 'NOT_AUTHORIZED',
        message: 'Agent 建议尚未获得会话清理授权'
      }
    }
    return { authorized: true, source: 'agent-session' }
  }

  return {
    authorized: false,
    source: 'none',
    code: 'NOT_AUTHORIZED',
    message: '当前候选项未获得清理授权'
  }
}

export function isCandidateAuthorizedForCleanupPreview(
  context: SessionCleanupAuthContext
): boolean {
  return evaluateSessionCleanupAuthorization(context).authorized
}

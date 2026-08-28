import { existsSync } from 'fs'
import { realpath } from 'fs/promises'
import { resolve } from 'path'
import type { CleanupAction, ScanCandidate } from '../../shared/types'
import { expandEnvVars, isPathUnderRoot, normalizePath } from '../../shared/path-utils'
import { isPathAuthorizedByRule } from '../../shared/rule-match'
import { getProtectedPaths, getAllRulesWithMeta, getPathAccessPolicy } from '../rules'
import { isRuleOrdinaryDeletable } from '../../shared/rule-enforcement'
import { isPathOrdinaryDeleteForbidden } from '../../shared/path-access-policy'
import { getScanSession } from '../scan/scan-session-store'
import type { CleanupAuthorizationSource } from '../../shared/session-cleanup-authorization'
import { authorizeSessionCandidates } from './session-cleanup-authorizer'
import {
  validateAndCreateCleanupExecutionSnapshot,
  type CleanupExecutionSnapshot
} from './cleanup-execution-guard'

export type { CleanupExecutionSnapshot }

export interface ValidatedAction extends CleanupAction {
  resolvedPath: string
  authorizationSource: CleanupAuthorizationSource
  executionSnapshot: CleanupExecutionSnapshot
}

export interface ValidationResult {
  approved: ValidatedAction[]
  rejected: Array<{ path: string; reason: string; code?: string }>
}

async function resolveSafePath(targetPath: string): Promise<string | null> {
  try {
    const absolute = resolve(expandEnvVars(targetPath))
    if (!existsSync(absolute)) return null
    return await realpath(absolute)
  } catch {
    return null
  }
}

export async function validateCandidateSnapshot(
  candidate: ScanCandidate,
  resolvedPath: string
): Promise<string | null> {
  const result = await validateAndCreateCleanupExecutionSnapshot({
    candidate,
    resolvedPath,
    authorizationSource: 'local-rule'
  })
  return result.ok ? null : result.reason
}

export async function validateCleanupActions(
  sessionId: string,
  actions: CleanupAction[]
): Promise<ValidationResult> {
  const session = getScanSession(sessionId)
  if (!session) {
    return {
      approved: [],
      rejected: actions.map((a) => ({
        path: a.target,
        reason: '扫描会话已过期或无效',
        code: 'SESSION_STALE'
      }))
    }
  }

  const protectedPaths = getProtectedPaths()
  const pathAccessPolicy = getPathAccessPolicy()
  const approved: ValidatedAction[] = []
  const rejected: ValidationResult['rejected'] = []

  for (const action of actions) {
    if (action.operation !== 'trash') {
      rejected.push({
        path: action.target,
        reason: '不允许的清理动作',
        code: 'ACTION_NOT_ALLOWED'
      })
      continue
    }

    const candidate = session.candidates.get(action.candidateId)
    if (!candidate) {
      rejected.push({
        path: action.target,
        reason: '候选项不属于当前扫描会话',
        code: 'CANDIDATE_NOT_FOUND'
      })
      continue
    }

    if (candidate.path !== action.target) {
      rejected.push({
        path: action.target,
        reason: '路径与扫描记录不一致',
        code: 'SNAPSHOT_STALE'
      })
      continue
    }

    const [authResult] = authorizeSessionCandidates(session, [action.candidateId])
    if (!authResult?.authorized) {
      rejected.push({
        path: candidate.path,
        reason: authResult?.message ?? '当前候选项未获得清理授权',
        code: authResult?.code ?? 'NOT_AUTHORIZED'
      })
      continue
    }

    const ruleMeta = getAllRulesWithMeta().find((item) => item.id === candidate.ruleId)
    if (authResult.source === 'local-rule') {
      if (!ruleMeta || !ruleMeta.enabled) {
        rejected.push({ path: candidate.path, reason: '规则未启用或不存在', code: 'NOT_AUTHORIZED' })
        continue
      }
      if (!isRuleOrdinaryDeletable(ruleMeta)) {
        rejected.push({ path: candidate.path, reason: '该规则项不允许删除', code: 'ACTION_NOT_ALLOWED' })
        continue
      }
    }

    if (authResult.source === 'local-rule' && candidate.executionSafety !== 'rule-eligible') {
      rejected.push({ path: candidate.path, reason: '候选项未获得规则执行资格', code: 'NOT_AUTHORIZED' })
      continue
    }

    if (authResult.source === 'agent-session' && candidate.executionSafety !== 'agent-confirmable') {
      rejected.push({ path: candidate.path, reason: '候选项未获得 Agent 会话执行资格', code: 'NOT_AUTHORIZED' })
      continue
    }

    const resolvedPath = await resolveSafePath(candidate.path)
    if (!resolvedPath) {
      rejected.push({ path: candidate.path, reason: '路径不存在或无法访问', code: 'SNAPSHOT_STALE' })
      continue
    }

    if (isPathOrdinaryDeleteForbidden(resolvedPath, protectedPaths, pathAccessPolicy)) {
      rejected.push({ path: candidate.path, reason: '路径在系统保护范围内', code: 'PROTECTED_PATH' })
      continue
    }

    const normalizedInput = normalizePath(candidate.path)
    const normalizedResolved = normalizePath(resolvedPath)
    if (normalizedInput !== normalizedResolved && !isPathUnderRoot(normalizedResolved, normalizedInput)) {
      rejected.push({
        path: candidate.path,
        reason: '路径解析异常（可能为符号链接）',
        code: 'SNAPSHOT_STALE'
      })
      continue
    }

    if (authResult.source === 'local-rule' && ruleMeta) {
      if (!(await isPathAuthorizedByRule(resolvedPath, ruleMeta, { parentTarget: candidate.parentTarget }))) {
        rejected.push({ path: candidate.path, reason: '路径未精确匹配规则范围', code: 'NOT_AUTHORIZED' })
        continue
      }
    }

    const snapshotResult = await validateAndCreateCleanupExecutionSnapshot({
      candidate,
      resolvedPath,
      authorizationSource: authResult.source
    })
    if (!snapshotResult.ok) {
      rejected.push({ path: candidate.path, reason: snapshotResult.reason, code: 'SNAPSHOT_STALE' })
      continue
    }

    approved.push({
      ...action,
      target: candidate.path,
      resolvedPath,
      authorizationSource: authResult.source,
      executionSnapshot: snapshotResult.snapshot
    })
  }

  return { approved, rejected }
}

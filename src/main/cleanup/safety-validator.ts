import { existsSync } from 'fs'
import { realpath, lstat } from 'fs/promises'
import { resolve } from 'path'
import type { CleanupAction, ScanCandidate } from '../../shared/types'
import { expandEnvVars, isPathUnderRoot, normalizePath, isProtectedPath } from '../../shared/path-utils'
import { isPathAuthorizedByRule } from '../../shared/rule-match'
import { getProtectedPaths, getAllRulesWithMeta } from '../rules'
import { getScanSession } from '../scan/scan-session-store'
import {
  DEFAULT_MEASURE_MAX_DEPTH,
  measurePathDetailedWithTimeout
} from '../scanner/measure-size'

export interface ValidatedAction extends CleanupAction {
  resolvedPath: string
}

export interface ValidationResult {
  approved: ValidatedAction[]
  rejected: Array<{ path: string; reason: string }>
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
  try {
    const info = await lstat(resolvedPath)
    if (info.isSymbolicLink()) {
      return '符号链接不允许'
    }

    if (candidate.entryKind === 'file' && !info.isFile()) {
      return '路径类型自扫描后已变化'
    }
    if (candidate.entryKind === 'directory' && !info.isDirectory()) {
      return '路径类型自扫描后已变化'
    }

    if (candidate.mtimeMs !== undefined && info.mtimeMs !== candidate.mtimeMs) {
      return '自扫描后已发生变化'
    }

    if (candidate.entryKind === 'file') {
      if (info.size !== candidate.size) {
        return '文件大小与扫描时不一致'
      }
      return null
    }

    if (candidate.snapshotComplete === false) {
      return '目录快照不完整，无法安全清理'
    }

    const remeasured = await measurePathDetailedWithTimeout(resolvedPath, DEFAULT_MEASURE_MAX_DEPTH)
    if (remeasured.incomplete) {
      return '目录快照不完整，无法安全清理'
    }
    if (remeasured.size !== candidate.size) {
      return '目录大小与扫描时不一致'
    }

    return null
  } catch {
    return '无法读取文件状态'
  }
}

export async function validateCleanupActions(
  sessionId: string,
  actions: CleanupAction[]
): Promise<ValidationResult> {
  const session = getScanSession(sessionId)
  if (!session) {
    return {
      approved: [],
      rejected: actions.map((a) => ({ path: a.target, reason: '扫描会话已过期或无效' }))
    }
  }

  const protectedPaths = getProtectedPaths()
  const approved: ValidatedAction[] = []
  const rejected: Array<{ path: string; reason: string }> = []

  for (const action of actions) {
    const candidate = session.candidates.get(action.candidateId)
    if (!candidate) {
      rejected.push({ path: action.target, reason: '候选项不属于当前扫描会话' })
      continue
    }

    if (candidate.path !== action.target) {
      rejected.push({ path: action.target, reason: '路径与扫描记录不一致' })
      continue
    }

    const ruleMeta = getAllRulesWithMeta().find((item) => item.id === action.ruleId)
    if (!ruleMeta || !ruleMeta.enabled) {
      rejected.push({ path: action.target, reason: '规则未启用或不存在' })
      continue
    }

    const rule = ruleMeta
    if (rule.deletable === false || rule.category === 'dangerous' || rule.nativeManaged) {
      rejected.push({ path: action.target, reason: '该规则项不允许删除' })
      continue
    }

    if (!candidate.deletable) {
      rejected.push({ path: action.target, reason: '候选项标记为不可删除' })
      continue
    }

    const resolvedPath = await resolveSafePath(action.target)
    if (!resolvedPath) {
      rejected.push({ path: action.target, reason: '路径不存在或无法访问' })
      continue
    }

    if (isProtectedPath(resolvedPath, protectedPaths)) {
      rejected.push({ path: action.target, reason: '路径在系统保护范围内' })
      continue
    }

    const normalizedInput = normalizePath(action.target)
    const normalizedResolved = normalizePath(resolvedPath)
    if (normalizedInput !== normalizedResolved && !isPathUnderRoot(normalizedResolved, normalizedInput)) {
      rejected.push({ path: action.target, reason: '路径解析异常（可能为符号链接）' })
      continue
    }

    if (!(await isPathAuthorizedByRule(resolvedPath, rule, { parentTarget: candidate.parentTarget }))) {
      rejected.push({ path: action.target, reason: '路径未精确匹配规则范围' })
      continue
    }

    const snapshotError = await validateCandidateSnapshot(candidate, resolvedPath)
    if (snapshotError) {
      rejected.push({ path: action.target, reason: snapshotError })
      continue
    }

    approved.push({ ...action, resolvedPath })
  }

  return { approved, rejected }
}

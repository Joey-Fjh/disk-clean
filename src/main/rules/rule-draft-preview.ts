import type { ScanItem } from '../../shared/types'
import type { RuleDraftPreviewResult, RuleDraftV1 } from '../../shared/rule-layer-types'
import { RULE_DRAFT_LIMITS } from '../../shared/rule-draft-limits'
import {
  expandEnvVars,
  getDriveLetter,
  isProtectedPath,
  isPathUnderRoot,
  normalizePath
} from '../../shared/path-utils'
import { collectRuleTargets } from '../../shared/rule-match'
import { compileRuleDraftToRuleConfig } from './rule-draft-compiler'
import { sanitizeHierarchyPath } from '../agent/path-sanitize'
import type { ScanSession } from '../scan/scan-session-store'
import { loadCoreSafetyPolicy } from './rule-layer-loader'
import {
  exceedsApprovalMatchLimit,
  exceedsApprovalTargetLimit,
  isDriveRootPlaceholder,
  MAX_APPROVABLE_RULE_TARGETS
} from './rule-draft-scope'

export function sessionFingerprint(session: ScanSession): string {
  return `${session.sessionId}:${session.createdAt}:${session.revision}`
}

function candidateMatchesRuleTargets(candidate: ScanItem, targets: string[]): boolean {
  const normalized = normalizePath(candidate.path)
  return targets.some((target) => {
    const root = normalizePath(target)
    return normalized === root || isPathUnderRoot(normalized, root)
  })
}

function evaluateApproval(
  preview: Omit<RuleDraftPreviewResult, 'approvable' | 'blockReason' | 'previewedAt' | 'scope'>,
  draft: RuleDraftV1
): { approvable: boolean; blockReason?: string; warnings: string[] } {
  const warnings = [...preview.warnings]

  if (draft.basePlaceholders.some((placeholder) => isDriveRootPlaceholder(placeholder))) {
    return { approvable: false, blockReason: '禁止批准盘符根目录规则', warnings }
  }
  if (preview.protectedTargetCount > 0) {
    return { approvable: false, blockReason: '规则目标包含受保护路径', warnings }
  }
  if (exceedsApprovalTargetLimit(preview.ruleTargetCount)) {
    return {
      approvable: false,
      blockReason: `规则目标数量过多（>${MAX_APPROVABLE_RULE_TARGETS}）`,
      warnings
    }
  }
  if (exceedsApprovalMatchLimit(preview.matchCount)) {
    return { approvable: false, blockReason: '扫描匹配范围过宽', warnings }
  }
  if (preview.ruleTargetCount === 0) {
    return { approvable: false, blockReason: '规则未解析出任何目标路径', warnings }
  }
  if (preview.matchCount === 0) {
    return { approvable: false, blockReason: '零匹配草稿不能批准', warnings }
  }
  if (draft.rebuildable !== true) {
    warnings.push('rebuildable 未明确为 true，批准后仅作为识别规则，不可删除')
  }

  return { approvable: true, warnings }
}

export async function previewRuleDraftOnSession(
  draft: RuleDraftV1,
  session: ScanSession,
  draftId = 'preview'
): Promise<RuleDraftPreviewResult> {
  const protectedPaths = loadCoreSafetyPolicy().protectedPaths
  const warnings: string[] = []
  const rule = compileRuleDraftToRuleConfig(draft, draftId)
  const ruleTargets = await collectRuleTargets(rule)

  let protectedTargetCount = 0
  for (const target of ruleTargets) {
    if (isProtectedPath(target, protectedPaths)) protectedTargetCount += 1
  }

  const matches: ScanItem[] = []
  let excludedProtectedCount = 0

  for (const candidate of session.candidates.values()) {
    if (!candidateMatchesRuleTargets(candidate, ruleTargets)) continue
    if (isProtectedPath(candidate.path, protectedPaths)) {
      excludedProtectedCount += 1
      continue
    }
    matches.push(candidate)
  }

  if (ruleTargets.length === 0) warnings.push('规则未解析出任何目标路径')
  if (matches.length === 0) warnings.push('当前扫描未匹配到候选项')
  if (protectedTargetCount > 0) warnings.push(`规则目标含 ${protectedTargetCount} 个受保护路径`)
  if (exceedsApprovalTargetLimit(ruleTargets.length)) {
    warnings.push(`规则目标数量 ${ruleTargets.length}，范围过宽`)
  }

  const drives = [...new Set(matches.map((item) => getDriveLetter(item.path)))]
  const estimatedBytes = matches.reduce((sum, item) => sum + item.size, 0)
  const samples = matches.slice(0, RULE_DRAFT_LIMITS.MAX_PREVIEW_SAMPLES).map((item) => ({
    candidateId: item.id,
    pathSummary: sanitizeHierarchyPath(item.path, {}),
    size: item.size
  }))

  const base = {
    sessionId: session.sessionId,
    sessionFingerprint: sessionFingerprint(session),
    matchCount: matches.length,
    ruleTargetCount: ruleTargets.length,
    estimatedBytes,
    excludedProtectedCount,
    protectedTargetCount,
    drives,
    samples,
    warnings
  }

  const approval = evaluateApproval(base, draft)

  return {
    ...base,
    warnings: approval.warnings,
    approvable: approval.approvable,
    blockReason: approval.blockReason,
    scope: {
      basePlaceholders: [...draft.basePlaceholders],
      subdirs: draft.subdirs ? [...draft.subdirs] : undefined,
      globDirs: draft.globDirs ? [...draft.globDirs] : undefined,
      relativePatterns: draft.relativePatterns ? [...draft.relativePatterns] : undefined,
      suggestedRisk: draft.suggestedRisk,
      reason: draft.reason,
      impact: draft.impact,
      rebuildable: draft.rebuildable
    },
    previewedAt: new Date().toISOString()
  }
}

export function canApproveRuleDraftPreview(
  preview: RuleDraftPreviewResult,
  session: ScanSession | null
): { ok: boolean; reason?: string } {
  if (!session) {
    return { ok: false, reason: '扫描会话已失效，请重新扫描并预览' }
  }
  if (preview.sessionId !== session.sessionId) {
    return { ok: false, reason: '预览绑定的扫描会话已失效' }
  }
  if (preview.sessionFingerprint !== sessionFingerprint(session)) {
    return { ok: false, reason: '扫描会话已更新，请重新预览' }
  }
  if (!preview.approvable) {
    return { ok: false, reason: preview.blockReason ?? '当前预览不可批准' }
  }
  return { ok: true }
}

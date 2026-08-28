import type { CandidateRefIndex } from './candidate-ref-index'
import { buildCandidateRefIndex } from './candidate-ref-index'
import { hasLocalCleanupAuthorization, isRuleBackedCandidate, isSpaceOnlyCandidate } from './candidate-judgment'
import {
  DEFAULT_PATH_ACCESS_POLICY,
  isHighRiskReadableCandidate,
  isPathReadableForInvestigation,
  type PathAccessPolicy
} from './path-access-policy'
import type { ScanItem } from './types'

/** 5B 多轮调查候选类型（本轮仅准备结构，不触发工具循环）。 */
export type AgentCandidateKind =
  | 'large-directory'
  | 'large-file'
  | 'rule-confirmed'
  | 'heuristic-suspect'
  | 'unknown-occupancy'
  | 'high-risk-readable'
  | 'truncated'

export interface AgentInvestigationCandidate {
  candidateId: string
  candidateRef: string
  kind: AgentCandidateKind
  priority: number
  reclaimableBytesEstimate: number
  riskLevel: 'low' | 'medium' | 'high'
  summary: string
  ruleId?: string
  contentType: ScanItem['contentType']
  locallyAuthorized: boolean
  truncatedReason?: string
}

export interface AgentCandidateSelectionOptions {
  maxCandidates?: number
  minBytes?: number
  pathAccessPolicy?: PathAccessPolicy
  /** 若提供则复用 canonical ref，排序仅影响调查优先级，不重新编号。 */
  refIndex?: Pick<CandidateRefIndex, 'idToRef' | 'fingerprint' | 'revision'>
}

function kindForItem(item: ScanItem, policy: PathAccessPolicy): AgentCandidateKind {
  if (item.sizePartial || item.snapshotComplete === false) return 'truncated'
  if (isHighRiskReadableCandidate(item.path, policy)) return 'high-risk-readable'
  if (item.judgment.judgmentOrigin === 'protected-policy') return 'unknown-occupancy'
  if (isRuleBackedCandidate(item) && hasLocalCleanupAuthorization(item)) return 'rule-confirmed'
  if (item.discoverySources.includes('local-feature')) return 'heuristic-suspect'
  if (item.entryKind === 'file' || item.contentType === 'large-file') return 'large-file'
  if (item.entryKind === 'directory' || item.contentType === 'large-dir') return 'large-directory'
  return 'unknown-occupancy'
}

function riskLevelForItem(item: ScanItem, policy: PathAccessPolicy): 'low' | 'medium' | 'high' {
  if (isHighRiskReadableCandidate(item.path, policy)) return 'high'
  if (item.judgment.judgmentOrigin === 'protected-policy') return 'high'
  if (item.contentType === 'system-protected' || item.contentType === 'user-data') return 'high'
  if (item.category === 'safe' && hasLocalCleanupAuthorization(item)) return 'low'
  if (item.category === 'recommended') return 'medium'
  return 'medium'
}

function priorityScore(item: ScanItem, policy: PathAccessPolicy): number {
  let score = Math.log10(Math.max(item.size, 1))
  if (isSpaceOnlyCandidate(item)) score += 2
  if (isHighRiskReadableCandidate(item.path, policy)) score += 1.5
  if (item.judgment.judgmentOrigin === 'protected-policy') score += 0.5
  if (item.discoverySources.includes('local-feature')) score += 0.5
  if (hasLocalCleanupAuthorization(item)) score += 0.25
  if (item.judgment.status === 'uncertain' || item.judgment.status === 'pending') score += 1
  if (riskLevelForItem(item, policy) === 'high') score += 0.5
  return score
}

export function buildAgentInvestigationCandidates(
  items: ScanItem[],
  options: AgentCandidateSelectionOptions = {}
): AgentInvestigationCandidate[] {
  const maxCandidates = options.maxCandidates ?? 12
  const minBytes = options.minBytes ?? 50 * 1024 * 1024
  const policy = options.pathAccessPolicy ?? DEFAULT_PATH_ACCESS_POLICY

  const idToRef =
    options.refIndex?.idToRef ??
    buildCandidateRefIndex(items, options.refIndex?.fingerprint ?? 'local', options.refIndex?.revision ?? 0)
      .idToRef

  const eligible = items.filter((item) => {
    if (item.judgment.status === 'identifying' || item.judgment.status === 'pending') return false
    if (!isPathReadableForInvestigation(item.path, policy)) return false
    if (
      !isHighRiskReadableCandidate(item.path, policy) &&
      item.judgment.judgmentOrigin === 'protected-policy'
    ) {
      return false
    }
    if (item.size < minBytes && !isRuleBackedCandidate(item)) return false
    return true
  })

  const ranked = [...eligible].sort((a, b) => priorityScore(b, policy) - priorityScore(a, policy))

  return ranked.slice(0, maxCandidates).map((item) => ({
    candidateId: item.id,
    candidateRef: idToRef.get(item.id) ?? `candidate-unknown`,
    kind: kindForItem(item, policy),
    priority: priorityScore(item, policy),
    reclaimableBytesEstimate: hasLocalCleanupAuthorization(item) ? item.size : 0,
    riskLevel: riskLevelForItem(item, policy),
    summary: item.reason ?? item.agentInsight?.likelyContent ?? item.ruleName,
    ruleId: item.ruleId,
    contentType: item.contentType,
    locallyAuthorized: hasLocalCleanupAuthorization(item),
    truncatedReason: item.sizePartial ? '扫描深度或权限受限' : undefined
  }))
}

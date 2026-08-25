import type {
  CandidateEvidence,
  CandidateJudgment,
  CandidateSelection,
  Category,
  ConfidenceLevel,
  DiscoverySource,
  JudgmentStatus,
  OccupancyObservation,
  ScanItem,
  SuggestedAction
} from './types'
import { normalizeScanPath } from './scan-path'

const PENDING_REASON =
  '当前版本尚未启用智能判断，仅展示空间占用'

const INCOMPLETE_SNAPSHOT_REASON =
  '扫描快照不完整，请重新扫描或进一步调查'

export function discoverySourceFromLegacySource(source: ScanItem['source']): DiscoverySource {
  return source === 'rule' ? 'rule' : 'space-scan'
}

export function judgmentStatusFromLegacyCategory(category: Category): JudgmentStatus {
  if (category === 'safe') return 'suggested'
  if (category === 'recommended') return 'caution'
  return 'keep'
}

export function legacyCategoryFromJudgment(status: JudgmentStatus): Category {
  if (status === 'suggested') return 'safe'
  if (status === 'caution') return 'recommended'
  return 'dangerous'
}

export function confidenceFromLegacyCategory(category: Category): ConfidenceLevel {
  if (category === 'safe') return 'high'
  if (category === 'recommended') return 'medium'
  return 'unknown'
}

export function occupancyObservationFromSpaceItem(item: ScanItem): OccupancyObservation {
  return {
    size: item.size,
    sizePartial: item.sizePartial,
    snapshotComplete: item.snapshotComplete,
    mtimeMs: item.mtimeMs,
    entryKind: item.entryKind,
    source: 'space-scan'
  }
}

function formatBytesForEvidence(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit > 0 ? 1 : 0)} ${units[unit]}`
}

function buildSpaceEvidence(item: ScanItem): CandidateEvidence {
  const obs = item.occupancyObservation
  const size = obs?.size ?? (item.source === 'analyzer' ? item.size : undefined)
  const partial = obs?.sizePartial ?? item.sizePartial
  const sizeNote =
    size !== undefined
      ? `空间占用估算：${formatBytesForEvidence(size)}${partial ? '（深度受限可能不完整）' : ''}`
      : item.sizePartial
        ? '逻辑大小估算（可能不完整）'
        : '逻辑大小估算'
  return {
    source: 'space-scan',
    summary: `${sizeNote}；${item.reason ?? '磁盘空间占用'}`
  }
}

function buildRuleEvidence(item: ScanItem): CandidateEvidence {
  return {
    source: 'rule',
    summary: item.reason ?? item.description ?? `规则：${item.ruleName}`,
    ruleId: item.ruleId,
    ruleName: item.ruleName
  }
}

export function buildEvidenceForItem(item: ScanItem): CandidateEvidence[] {
  const sources = item.discoverySources ?? [discoverySourceFromLegacySource(item.source)]
  const evidence: CandidateEvidence[] = []

  if (sources.includes('space-scan')) {
    evidence.push(buildSpaceEvidence(item))
  }
  if (sources.includes('rule')) {
    evidence.push(buildRuleEvidence(item))
  }

  return evidence
}

function mergeEvidenceLists(left: CandidateEvidence[], right: CandidateEvidence[]): CandidateEvidence[] {
  const merged: CandidateEvidence[] = [...left]
  for (const entry of right) {
    const duplicate = merged.some(
      (existing) =>
        existing.source === entry.source &&
        existing.summary === entry.summary &&
        existing.ruleId === entry.ruleId &&
        existing.ruleName === entry.ruleName
    )
    if (!duplicate) merged.push(entry)
  }
  return merged
}

function isRuleBacked(item: ScanItem): boolean {
  return item.discoverySources?.includes('rule') ?? item.source === 'rule'
}

function deriveJudgmentFromLegacyRuleItem(item: ScanItem): CandidateJudgment {
  const status = judgmentStatusFromLegacyCategory(item.category)
  return {
    status,
    source: 'legacy-rule',
    confidence: confidenceFromLegacyCategory(item.category),
    basis: [
      `命中规则：${item.ruleName}`,
      item.reason ?? item.description ?? '规则定义的可清理项'
    ].filter(Boolean)
  }
}

function derivePendingJudgment(item: ScanItem): CandidateJudgment {
  return {
    status: 'pending',
    source: 'none',
    confidence: 'unknown',
    basis: [item.reason ?? '空间扫描发现占用']
  }
}

export function deriveSelection(item: ScanItem, judgment: CandidateJudgment): CandidateSelection {
  if (judgment.status === 'pending') {
    return { selectable: false, notSelectableReason: PENDING_REASON }
  }
  if (judgment.status === 'uncertain') {
    return { selectable: false, notSelectableReason: '信息不足，无法确定是否可清理' }
  }
  if (judgment.status === 'keep') {
    return { selectable: false, notSelectableReason: item.impact ?? '建议保留，不建议清理' }
  }
  if (isRuleBacked(item) && !item.snapshotComplete) {
    return { selectable: false, notSelectableReason: INCOMPLETE_SNAPSHOT_REASON }
  }
  if (!item.deletable) {
    return { selectable: false, notSelectableReason: item.impact ?? '当前规则不允许清理' }
  }
  return { selectable: true }
}

export function deriveSuggestedAction(item: ScanItem, judgment: CandidateJudgment): SuggestedAction {
  if (
    !item.deletable ||
    judgment.status === 'pending' ||
    judgment.status === 'keep' ||
    judgment.status === 'uncertain' ||
    (isRuleBacked(item) && !item.snapshotComplete)
  ) {
    return 'none'
  }
  return 'recycle'
}

export function mapSpaceScanItem(item: ScanItem): ScanItem {
  const judgment = derivePendingJudgment(item)
  const discoverySources: DiscoverySource[] = ['space-scan']
  const selection = deriveSelection({ ...item, deletable: false }, judgment)

  return normalizeCandidate({
    ...item,
    source: 'analyzer',
    category: 'dangerous',
    deletable: false,
    autoSelect: false,
    discoverySources,
    evidence: [],
    judgment,
    selection,
    suggestedAction: 'none'
  })
}

export function mapRuleScanItem(item: ScanItem): ScanItem {
  return normalizeCandidate({
    ...item,
    source: 'rule',
    discoverySources: ['rule'],
    evidence: [],
    judgment: deriveJudgmentFromLegacyRuleItem(item),
    category: legacyCategoryFromJudgment(judgmentStatusFromLegacyCategory(item.category))
  })
}

/** 确保 Candidate 判断字段完整，并与 legacy 字段保持同步。 */
export function normalizeCandidate(item: ScanItem): ScanItem {
  const discoverySources =
    item.discoverySources && item.discoverySources.length > 0
      ? [...new Set(item.discoverySources)]
      : [discoverySourceFromLegacySource(item.source)]

  const hasRule = discoverySources.includes('rule')

  let judgment = item.judgment
  if (!judgment) {
    judgment =
      hasRule && item.source === 'rule'
        ? deriveJudgmentFromLegacyRuleItem(item)
        : derivePendingJudgment(item)
  }

  const occupancyObservation =
    item.occupancyObservation ??
    (!hasRule && item.source === 'analyzer' ? occupancyObservationFromSpaceItem(item) : undefined)

  const evidence =
    item.evidence && item.evidence.length > 0
      ? mergeEvidenceLists([], item.evidence)
      : buildEvidenceForItem({ ...item, occupancyObservation })

  const category = legacyCategoryFromJudgment(judgment.status)
  const selection = deriveSelection(item, judgment)
  const suggestedAction = deriveSuggestedAction(item, judgment)
  const deletable = selection.selectable

  return {
    ...item,
    category,
    deletable,
    discoverySources,
    evidence,
    judgment,
    agentInsight: item.agentInsight,
    selection,
    suggestedAction,
    occupancyObservation
  }
}

function pickSpaceOnlyItem(left: ScanItem, right: ScanItem): ScanItem | null {
  if (left.discoverySources.includes('space-scan') && !left.discoverySources.includes('rule')) {
    return left
  }
  if (right.discoverySources.includes('space-scan') && !right.discoverySources.includes('rule')) {
    return right
  }
  return null
}

function pickRuleItem(left: ScanItem, right: ScanItem): ScanItem | null {
  if (right.discoverySources.includes('rule')) return right
  if (left.discoverySources.includes('rule')) return left
  return null
}

/** 同路径合并：规则项承载执行快照，空间项保留为 occupancyObservation。 */
export function mergeScanCandidates(existing: ScanItem, incoming: ScanItem): ScanItem {
  const left = normalizeCandidate(existing)
  const right = normalizeCandidate(incoming)

  const discoverySources = [...new Set([...left.discoverySources, ...right.discoverySources])]
  const evidence = mergeEvidenceLists(left.evidence, right.evidence)

  const ruleItem = pickRuleItem(left, right)
  const spaceOnlyItem = pickSpaceOnlyItem(left, right)

  if (ruleItem) {
    const occupancyObservation = mergeOccupancyObservation(
      left.occupancyObservation,
      right.occupancyObservation,
      spaceOnlyItem ? occupancyObservationFromSpaceItem(spaceOnlyItem) : undefined
    )

    const merged = normalizeCandidate({
      ...ruleItem,
      path: ruleItem.path,
      discoverySources,
      evidence,
      occupancyObservation,
      judgment: deriveJudgmentFromLegacyRuleItem(ruleItem),
      reason: ruleItem.reason ?? left.reason ?? right.reason,
      impact: ruleItem.impact ?? left.impact ?? right.impact,
      description: ruleItem.description ?? left.description ?? right.description,
      parentTarget: ruleItem.parentTarget ?? left.parentTarget ?? right.parentTarget
    })
    return merged
  }

  const spaceItem = spaceOnlyItem ?? right
  return normalizeCandidate({
    ...spaceItem,
    discoverySources,
    evidence,
    judgment: derivePendingJudgment(spaceItem),
    deletable: false
  })
}

function mergeOccupancyObservation(
  left?: OccupancyObservation,
  right?: OccupancyObservation,
  spaceOnly?: OccupancyObservation
): OccupancyObservation | undefined {
  return spaceOnly ?? right ?? left
}

export function getJudgmentStatusLabel(status: JudgmentStatus): string {
  switch (status) {
    case 'pending':
      return '待判断'
    case 'suggested':
      return '建议清理'
    case 'caution':
      return '谨慎处理'
    case 'keep':
      return '建议保留'
    case 'uncertain':
      return '无法确定'
    default:
      return status
  }
}

export function isCandidateEquivalent(a: ScanItem, b: ScanItem): boolean {
  const left = normalizeScanPath(a.path)
  const right = normalizeScanPath(b.path)
  if (left !== right) return false

  return (
    a.id === b.id &&
    a.ruleId === b.ruleId &&
    a.ruleName === b.ruleName &&
    a.category === b.category &&
    a.contentType === b.contentType &&
    a.drive === b.drive &&
    a.size === b.size &&
    a.sizeIsEstimate === b.sizeIsEstimate &&
    a.sizePartial === b.sizePartial &&
    a.snapshotComplete === b.snapshotComplete &&
    a.entryKind === b.entryKind &&
    a.mtimeMs === b.mtimeMs &&
    a.deletable === b.deletable &&
    a.autoSelect === b.autoSelect &&
    a.source === b.source &&
    a.suggestedAction === b.suggestedAction &&
    JSON.stringify(a.discoverySources) === JSON.stringify(b.discoverySources) &&
    JSON.stringify(a.evidence) === JSON.stringify(b.evidence) &&
    JSON.stringify(a.judgment) === JSON.stringify(b.judgment) &&
    JSON.stringify(a.selection) === JSON.stringify(b.selection) &&
    JSON.stringify(a.occupancyObservation) === JSON.stringify(b.occupancyObservation) &&
    a.reason === b.reason &&
    a.impact === b.impact &&
    a.description === b.description &&
    a.parentTarget === b.parentTarget &&
    a.ruleSource === b.ruleSource &&
    a.recoveryMode === b.recoveryMode &&
    a.rebuildable === b.rebuildable
  )
}

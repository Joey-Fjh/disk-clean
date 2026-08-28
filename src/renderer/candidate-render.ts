import { normalizeCandidate } from '../shared/candidate-model'
import { resolveUserFacingJudgmentSource } from '../shared/ux-flow-model'
import { formatBytes } from '../shared/format-bytes'
import type { OccupancyObservation, ScanItem } from '../shared/types'
import type { EvidenceRenderItem, ScanItemRenderInput } from './safe-render'

export const EVIDENCE_SOURCE_LABELS = {
  'space-scan': '空间发现',
  rule: '规则',
  'local-feature': '本地特征',
  agent: 'Agent'
} as const

function formatSize(bytes: number): string {
  return formatBytes(bytes)
}

function incompleteHint(obs: OccupancyObservation): string | undefined {
  if (obs.sizePartial || !obs.snapshotComplete) {
    return '深度受限，可能不完整'
  }
  return undefined
}

function buildOccupancySummary(obs: OccupancyObservation): string {
  const hint = incompleteHint(obs)
  return hint ? `约 ${formatSize(obs.size)}（${hint}）` : `约 ${formatSize(obs.size)}`
}

export function buildEvidenceItems(item: ScanItem, normalized: ScanItem): EvidenceRenderItem[] {
  const hasRule = normalized.discoverySources.includes('rule')
  const isIdentifying = normalized.judgment.status === 'identifying'
  const isPending = normalized.judgment.status === 'pending'
  const items: EvidenceRenderItem[] = []

  if (normalized.occupancyObservation && hasRule) {
    items.push({
      source: 'space-scan',
      sourceLabel: EVIDENCE_SOURCE_LABELS['space-scan'],
      summary: `空间观察：${buildOccupancySummary(normalized.occupancyObservation)}`
    })
  } else if ((isPending || isIdentifying) && normalized.discoverySources.includes('space-scan')) {
    const obs: OccupancyObservation =
      normalized.occupancyObservation ?? {
        size: item.size,
        sizePartial: item.sizePartial,
        snapshotComplete: item.snapshotComplete,
        entryKind: item.entryKind,
        source: 'space-scan'
      }
    items.push({
      source: 'space-scan',
      sourceLabel: EVIDENCE_SOURCE_LABELS['space-scan'],
      summary: buildOccupancySummary(obs)
    })
  }

  for (const entry of normalized.evidence) {
    if (entry.source === 'space-scan' && hasRule && normalized.occupancyObservation) {
      continue
    }
    if (entry.source === 'space-scan' && isPending && items.some((e) => e.source === 'space-scan')) {
      continue
    }
    items.push({
      source: entry.source,
      sourceLabel: EVIDENCE_SOURCE_LABELS[entry.source],
      summary: entry.summary
    })
  }

  return items
}

function resolveSizeCaption(normalized: ScanItem): string | undefined {
  const hasRule = normalized.discoverySources.includes('rule')

  if (hasRule && normalized.selection.selectable) {
    return '可清理逻辑大小估算'
  }
  if (normalized.judgment.status === 'identifying' || normalized.judgment.status === 'pending') {
    return '空间占用估算'
  }
  if (hasRule) {
    return '逻辑大小估算'
  }
  return undefined
}

export interface ScanItemRenderBuildInput {
  contentTypeLabel: string
}

function confidenceLabel(confidence: ScanItem['judgment']['confidence']): string | undefined {
  if (confidence === 'high') return '高'
  if (confidence === 'medium') return '中'
  if (confidence === 'low') return '低'
  return undefined
}

export function buildScanItemRenderInput(
  item: ScanItem,
  labels: ScanItemRenderBuildInput
): ScanItemRenderInput {
  const normalized = normalizeCandidate(item)
  const evidenceItems = buildEvidenceItems(item, normalized)

  return {
    fileName: item.path.replace(/\//g, '\\').split('\\').pop() || item.path,
    path: item.path,
    typeLabel: `${labels.contentTypeLabel} · ${item.drive}`,
    sizeLabel: formatSize(item.size),
    sizeCaption: resolveSizeCaption(normalized),
    briefReason: item.reason,
    riskSummary: item.impact ? `影响：${item.impact}` : undefined,
    sourceLabel: resolveUserFacingJudgmentSource(item),
    cleanupEligibility: normalized.judgment.judgmentOrigin === 'local-rule' ||
      normalized.judgment.judgmentOrigin === 'local-rule-agent-reviewed'
      ? `清理资格：${item.ruleName}`
      : normalized.judgment.judgmentOrigin === 'protected-policy'
        ? '清理资格：受保护路径，禁止清理'
        : '清理资格：尚未获得本地规则授权',
    agentReviewSummary: normalized.agentInsight
      ? `智能复核：${normalized.agentInsight.reason}`
      : normalized.judgment.judgmentOrigin === 'local-rule'
        ? '智能复核：未运行（使用本地规则）'
        : undefined,
    safetyCheckSummary:
      normalized.judgment.judgmentOrigin === 'protected-policy'
        ? '安全检查：命中受保护目录'
        : '安全检查：未命中受保护目录',
    impactSummary: item.impact ? `影响说明：${item.impact}` : undefined,
    appClosedWarning: item.requiresAppClosed ? '清理前请关闭相关软件' : undefined,
    notSelectableReason: normalized.selection.selectable
      ? undefined
      : normalized.selection.notSelectableReason,
    agentLikelyContent: normalized.agentInsight?.likelyContent,
    agentReason: normalized.agentInsight?.reason,
    agentImpact: normalized.agentInsight?.impact,
    agentConfidenceLabel:
      normalized.judgment.source === 'agent' ? confidenceLabel(normalized.judgment.confidence) : undefined,
    evidenceItems: evidenceItems.length > 0 ? evidenceItems : undefined,
    executionSizeBytes: item.size,
    occupancySizeBytes: normalized.occupancyObservation?.size
  }
}

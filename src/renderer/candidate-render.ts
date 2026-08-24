import { getJudgmentStatusLabel, normalizeCandidate } from '../shared/candidate-model'
import type { OccupancyObservation, ScanItem } from '../shared/types'
import type { EvidenceRenderItem, ScanItemRenderInput } from './safe-render'

export const EVIDENCE_SOURCE_LABELS = {
  'space-scan': '空间发现',
  rule: '规则',
  'local-feature': '本地特征',
  agent: 'Agent'
} as const

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function judgmentBadgeClass(status: ScanItem['judgment']['status']): string {
  if (status === 'suggested') return 'judgment-suggested'
  if (status === 'caution') return 'judgment-caution'
  if (status === 'keep') return 'judgment-keep'
  if (status === 'uncertain') return 'judgment-uncertain'
  return 'judgment-pending'
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
  const isPending = normalized.judgment.status === 'pending'
  const items: EvidenceRenderItem[] = []

  if (normalized.occupancyObservation && hasRule) {
    items.push({
      source: 'space-scan',
      sourceLabel: EVIDENCE_SOURCE_LABELS['space-scan'],
      summary: `空间观察：${buildOccupancySummary(normalized.occupancyObservation)}`
    })
  } else if (isPending && normalized.discoverySources.includes('space-scan')) {
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
  if (normalized.judgment.status === 'pending') {
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

export function buildScanItemRenderInput(
  item: ScanItem,
  labels: ScanItemRenderBuildInput
): ScanItemRenderInput {
  const normalized = normalizeCandidate(item)
  const evidenceItems = buildEvidenceItems(item, normalized)
  const isPending = normalized.judgment.status === 'pending'

  return {
    fileName: item.path.replace(/\//g, '\\').split('\\').pop() || item.path,
    path: item.path,
    typeLabel: `${labels.contentTypeLabel} · ${item.drive}${isPending ? ' · 空间发现' : ' · 逻辑大小估算'}`,
    sizeLabel: formatSize(item.size),
    sizeCaption: resolveSizeCaption(normalized),
    reason: item.reason,
    impact: normalized.selection.selectable ? item.impact : undefined,
    judgmentLabel: getJudgmentStatusLabel(normalized.judgment.status),
    judgmentClass: judgmentBadgeClass(normalized.judgment.status),
    notSelectableReason: normalized.selection.selectable
      ? undefined
      : normalized.selection.notSelectableReason,
    evidenceItems: evidenceItems.length > 0 ? evidenceItems : undefined,
    executionSizeBytes: item.size,
    occupancySizeBytes: normalized.occupancyObservation?.size
  }
}

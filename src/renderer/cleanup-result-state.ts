import { normalizeScanPath } from '../shared/scan-path'
import type { CleanupPlanPreview, CleanupResult, ScanItem } from '../shared/types'

export interface CleanupPrepareRejectionRecord {
  candidateId: string
  path: string
  message: string
  code?: string
}

export interface CleanupOutcomeManifest {
  sessionId: string
  succeededPaths: string[]
  executionFailed: Array<{ path: string; message: string; code?: string }>
  executionRejected: Array<{ path: string; reason: string; code?: string }>
  prepareRejected: CleanupPrepareRejectionRecord[]
  result: CleanupResult
  completedAt: number
}

export interface CleanupRescanComparison {
  disappeared: string[]
  stillPresent: string[]
  failed: string[]
  prepareRejected: string[]
  executionRejected: string[]
}

function normalizePathKey(path: string): string {
  return normalizeScanPath(path)
}

function pathsEqual(left: string, right: string): boolean {
  return normalizePathKey(left) === normalizePathKey(right)
}

function itemPathSet(items: ScanItem[]): Set<string> {
  return new Set(items.map((item) => normalizePathKey(item.path)))
}

export function buildCleanupOutcomeManifest(input: {
  sessionId: string
  selectedItems: Array<{ id: string; path: string }>
  preview: Pick<CleanupPlanPreview, 'approvedCandidateIds' | 'rejectedAtPrepare'>
  result: CleanupResult
  completedAt?: number
}): CleanupOutcomeManifest {
  const approvedIds = new Set(input.preview.approvedCandidateIds)
  const prepareRejectedFromPreview = input.preview.rejectedAtPrepare.map((entry) => {
    const selected = input.selectedItems.find((item) => item.id === entry.candidateId)
    return {
      candidateId: entry.candidateId,
      path: selected?.path ?? entry.candidateId,
      message: entry.message,
      code: entry.code
    }
  })

  const previewRejectedIds = new Set(prepareRejectedFromPreview.map((entry) => entry.candidateId))
  const extraPrepareRejected = input.selectedItems
    .filter((item) => !approvedIds.has(item.id) && !previewRejectedIds.has(item.id))
    .map((item) => ({
      candidateId: item.id,
      path: item.path,
      message: '未通过清理计划授权',
      code: 'NOT_AUTHORIZED'
    }))

  return {
    sessionId: input.sessionId,
    succeededPaths: [...input.result.succeeded],
    executionFailed: input.result.errors.map((entry) => ({
      path: entry.path,
      message: entry.message,
      code: entry.code
    })),
    executionRejected: input.result.rejected.map((entry) => ({
      path: entry.path,
      reason: entry.reason,
      code: entry.code
    })),
    prepareRejected: [...prepareRejectedFromPreview, ...extraPrepareRejected],
    result: input.result,
    completedAt: input.completedAt ?? Date.now()
  }
}

export function formatCleanupOutcomeSummary(manifest: CleanupOutcomeManifest): string {
  const result = manifest.result
  const parts = [
    `已移入回收站 ${result.moved} 项`,
    `估算 ${result.movedToTrashBytes} 字节`
  ]
  if (manifest.prepareRejected.length > 0) {
    parts.push(`计划阶段拒绝 ${manifest.prepareRejected.length}`)
  }
  if (result.skipped > 0) parts.push(`校验跳过 ${result.skipped}`)
  if (manifest.executionFailed.length > 0) {
    parts.push(`执行失败 ${manifest.executionFailed.length}`)
  }
  if (manifest.executionRejected.length > 0) {
    parts.push(`执行校验拒绝 ${manifest.executionRejected.length}`)
  }
  if (result.postReview) {
    parts.push(`已消失 ${result.postReview.removedCount}`)
    if (result.postReview.stillPresentCount > 0) {
      parts.push(`仍存在 ${result.postReview.stillPresentCount}`)
    }
  }
  return parts.join('；')
}

export function buildCleanupRescanComparison(
  manifest: CleanupOutcomeManifest,
  itemsAfterRescan: ScanItem[]
): CleanupRescanComparison {
  const afterPaths = itemPathSet(itemsAfterRescan)
  const disappeared: string[] = []
  const stillPresent: string[] = []

  for (const path of manifest.succeededPaths) {
    if (afterPaths.has(normalizePathKey(path))) {
      stillPresent.push(path)
    } else {
      disappeared.push(path)
    }
  }

  return {
    disappeared,
    stillPresent,
    failed: manifest.executionFailed.map((entry) => entry.path),
    prepareRejected: manifest.prepareRejected.map((entry) => entry.path),
    executionRejected: manifest.executionRejected.map((entry) => entry.path)
  }
}

export function formatCleanupRescanComparison(comparison: CleanupRescanComparison): string {
  const parts = [`重扫对比：${comparison.disappeared.length} 项已消失`]
  if (comparison.stillPresent.length > 0) {
    parts.push(`${comparison.stillPresent.length} 项仍存在`)
  }
  if (comparison.failed.length > 0) {
    parts.push(`${comparison.failed.length} 项执行失败`)
  }
  if (comparison.prepareRejected.length > 0) {
    parts.push(`${comparison.prepareRejected.length} 项计划阶段未批准`)
  }
  if (comparison.executionRejected.length > 0) {
    parts.push(`${comparison.executionRejected.length} 项执行校验拒绝`)
  }
  return parts.join('；')
}

export function pathSeenAfterRescan(itemsAfterRescan: ScanItem[], path: string): boolean {
  const key = normalizePathKey(path)
  return itemsAfterRescan.some((item) => pathsEqual(item.path, key) || normalizePathKey(item.path) === key)
}

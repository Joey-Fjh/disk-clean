import type { ScanItem } from './types'
import {
  isCandidateEquivalent,
  mapRuleScanItem,
  mapSpaceScanItem,
  mergeScanCandidates,
  normalizeCandidate
} from './candidate-model'
import { normalizeScanPath } from './scan-path'

function prepareIncomingItem(item: ScanItem): ScanItem {
  if (item.judgment && item.selection && item.discoverySources?.length) {
    return normalizeCandidate(item)
  }
  return item.source === 'rule' ? mapRuleScanItem(item) : mapSpaceScanItem(item)
}

export interface UpsertScanItemsResult {
  items: ScanItem[]
  upserted: ScanItem[]
}

/** 按路径 upsert 扫描候选项；同路径合并证据与判断，返回完整列表与本次新增/替换的增量。 */
export function upsertScanItems(existing: ScanItem[], incoming: ScanItem[]): UpsertScanItemsResult {
  if (incoming.length === 0) {
    return { items: existing, upserted: [] }
  }

  const byPath = new Map<string, ScanItem>()
  for (const item of existing) {
    byPath.set(normalizeScanPath(item.path), prepareIncomingItem(item))
  }

  const upserted: ScanItem[] = []
  for (const raw of incoming) {
    const item = prepareIncomingItem(raw)
    const key = normalizeScanPath(item.path)
    const current = byPath.get(key)
    if (!current) {
      byPath.set(key, item)
      upserted.push(item)
      continue
    }

    const merged = mergeScanCandidates(current, item)
    if (!isCandidateEquivalent(current, merged)) {
      byPath.set(key, merged)
      upserted.push(merged)
    }
  }

  return { items: Array.from(byPath.values()), upserted }
}

/** 模拟实时回调：按批次 upsert 累积，与 Renderer / ScanEngine 使用相同逻辑。 */
export function accumulateScanItemBatches(batches: ScanItem[][]): ScanItem[] {
  let items: ScanItem[] = []
  for (const batch of batches) {
    items = upsertScanItems(items, batch).items
  }
  return items
}

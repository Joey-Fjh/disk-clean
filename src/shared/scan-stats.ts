import type { ScanItem } from './types'

/** 可清理逻辑大小估算：仅统计用户可勾选的候选项，不含待判断的空间占用项。 */
export function computeDeletableTotalSize(items: ScanItem[]): number {
  return items
    .filter((item) => item.selection?.selectable ?? item.deletable)
    .reduce((sum, item) => sum + item.size, 0)
}

export function countScanItems(items: ScanItem[]): number {
  return items.length
}

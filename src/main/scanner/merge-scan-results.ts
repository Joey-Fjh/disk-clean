import type { ScanItem } from '../../shared/types'
import { upsertScanItems } from '../../shared/scan-item-accumulator'

/**
 * 合并扫描结果。仅对完全相同路径去重；父目录与子目录均保留。
 * 路径相同时合并为单一 Candidate，保留空间与规则证据，规则判断驱动 legacy 执行字段。
 */
export function mergeScanItems(existing: ScanItem[], incoming: ScanItem[]): ScanItem[] {
  return upsertScanItems(existing, incoming).items
}

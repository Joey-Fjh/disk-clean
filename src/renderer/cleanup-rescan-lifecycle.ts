export type PostCleanupRescanState =
  | 'idle'
  | 'rescanning'
  | 'rescan-completed'
  | 'rescan-failed'
  | 'rescan-cancelled'

export function formatPostCleanupRescanStatus(
  state: PostCleanupRescanState,
  cleanupSummary: string,
  detail?: string
): string {
  switch (state) {
    case 'rescan-completed':
      return detail ? `${cleanupSummary} · ${detail}` : cleanupSummary
    case 'rescan-failed':
      return `${cleanupSummary} · 清理已完成，重扫失败${detail ? `：${detail}` : ''}`
    case 'rescan-cancelled':
      return `${cleanupSummary} · 清理已完成，重扫已停止`
    case 'rescanning':
      return `${cleanupSummary} · 正在重新扫描以复核清理结果…`
    default:
      return cleanupSummary
  }
}

export function shouldApplyPostCleanupRescanComparison(state: PostCleanupRescanState): boolean {
  return state === 'rescan-completed'
}

export function shouldRetainCleanupSummary(state: PostCleanupRescanState): boolean {
  return state === 'rescanning' || state === 'rescan-completed' || state === 'rescan-failed' || state === 'rescan-cancelled'
}

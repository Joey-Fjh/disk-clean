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
      return `${cleanupSummary} · 自动复核失败${detail ? `：${detail}` : ''}，请重新复核`
    case 'rescan-cancelled':
      return `${cleanupSummary} · 自动复核已停止，请重新复核`
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

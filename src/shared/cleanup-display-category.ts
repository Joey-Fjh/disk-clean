import { hasLocalCleanupAuthorization, isRuleBackedCandidate, isSpaceOnlyCandidate } from './candidate-judgment'
import type { ScanItem } from './types'

/** 清理结果页展示分类（与 legacy Category 解耦）。 */
export type CleanupDisplayCategory =
  | 'recommended-clean'
  | 'caution-clean'
  | 'high-risk-action'
  | 'space-occupancy'
  | 'recommended-keep'
  | 'identifying'
  | 'analyzing'

export const CLEANUP_DISPLAY_CATEGORY_ORDER: CleanupDisplayCategory[] = [
  'recommended-clean',
  'caution-clean',
  'high-risk-action',
  'space-occupancy',
  'recommended-keep',
  'identifying',
  'analyzing'
]

export const CLEANUP_DISPLAY_CATEGORY_LABELS: Record<CleanupDisplayCategory, string> = {
  'recommended-clean': '建议清理',
  'caution-clean': '谨慎清理',
  'high-risk-action': '高风险操作',
  'space-occupancy': '空间占用',
  'recommended-keep': '建议保留',
  identifying: '正在识别',
  analyzing: '正在分析'
}

export const CLEANUP_DISPLAY_CATEGORY_DESCRIPTIONS: Record<CleanupDisplayCategory, string> = {
  'recommended-clean': '已有可靠清理授权，明确缓存或临时内容',
  'caution-clean': '可能可清理，需理解影响，默认不勾选',
  'high-risk-action': '需卸载、系统工具或单独确认，不能批量删除',
  'space-occupancy': '大文件或大目录，用于解释空间去向，不代表垃圾',
  'recommended-keep': '系统、配置、项目或 Agent 判断应保留',
  identifying: '扫描与本地规则整理进行中',
  analyzing: 'Agent 正在分析高占用位置'
}

export type CleanupActionKind =
  | 'delete-trash'
  | 'review-before-delete'
  | 'uninstall'
  | 'move'
  | 'system-managed'
  | 'keep'
  | 'no-action'

const SYSTEM_MANAGED_RULE_IDS = new Set(['winsxs', 'windows-old', 'hiberfil', 'pagefile'])

const NATIVE_MANAGED_RULE_IDS = new Set(['pnpm-store'])

export function resolveCleanupActionKind(item: ScanItem): CleanupActionKind {
  if (item.recoveryMode === 'native-managed' || NATIVE_MANAGED_RULE_IDS.has(item.ruleId)) {
    return 'system-managed'
  }
  if (SYSTEM_MANAGED_RULE_IDS.has(item.ruleId)) {
    return 'system-managed'
  }
  if (item.judgment?.judgmentOrigin === 'protected-policy') {
    return 'no-action'
  }
  if (!hasLocalCleanupAuthorization(item)) {
    if (item.judgment?.status === 'keep') return 'keep'
    if (item.contentType === 'user-data') return 'review-before-delete'
    return 'no-action'
  }
  if (item.judgment?.status === 'suggested') {
    return 'delete-trash'
  }
  if (item.judgment?.status === 'caution' || item.judgment?.status === 'uncertain') {
    return 'review-before-delete'
  }
  return 'no-action'
}

function resolveJudgmentStatus(item: ScanItem): ScanItem['judgment']['status'] {
  if (item.judgment?.status) return item.judgment.status
  if (item.category === 'safe') return 'suggested'
  if (item.category === 'recommended') return 'caution'
  return 'keep'
}

function resolveJudgmentOrigin(item: ScanItem): ScanItem['judgment']['judgmentOrigin'] | undefined {
  return item.judgment?.judgmentOrigin
}

export function resolveCleanupDisplayCategory(
  item: ScanItem,
  options?: { agentReviewing?: boolean }
): CleanupDisplayCategory {
  const status = resolveJudgmentStatus(item)
  const judgmentOrigin = resolveJudgmentOrigin(item)

  if (!item.judgment) {
    if (item.category === 'safe') return 'recommended-clean'
    if (item.category === 'recommended') return 'caution-clean'
    if (item.category === 'dangerous') return 'recommended-keep'
    return 'caution-clean'
  }
  if (status === 'identifying' || status === 'pending') {
    return options?.agentReviewing ? 'analyzing' : 'identifying'
  }

  if (item.recoveryMode === 'native-managed' || NATIVE_MANAGED_RULE_IDS.has(item.ruleId)) {
    return 'high-risk-action'
  }

  if (SYSTEM_MANAGED_RULE_IDS.has(item.ruleId)) {
    return 'high-risk-action'
  }

  if (
    isRuleBackedCandidate(item) &&
    item.deletable === false &&
    (item.contentType === 'system-protected' || item.contentType === 'install-leftover')
  ) {
    return 'high-risk-action'
  }

  if (judgmentOrigin === 'protected-policy') {
    return 'space-occupancy'
  }

  if (isSpaceOnlyCandidate(item)) {
    if (status === 'keep') return 'recommended-keep'
    return 'space-occupancy'
  }

  if (status === 'keep') {
    return 'recommended-keep'
  }

  if (status === 'suggested' && hasLocalCleanupAuthorization(item)) {
    return 'recommended-clean'
  }

  if ((status === 'caution' || status === 'uncertain') && hasLocalCleanupAuthorization(item)) {
    return 'caution-clean'
  }

  if (judgmentOrigin === 'agent-advice-only') {
    if (item.contentType === 'large-dir' || item.contentType === 'large-file') {
      return 'space-occupancy'
    }
    return 'caution-clean'
  }

  if (!hasLocalCleanupAuthorization(item)) {
    if (
      item.contentType === 'user-data' ||
      item.contentType === 'large-dir' ||
      item.contentType === 'large-file'
    ) {
      return 'space-occupancy'
    }
    return 'caution-clean'
  }

  return 'caution-clean'
}

export function groupItemsByDisplayCategory(
  items: ScanItem[],
  options?: { agentReviewing?: boolean }
): Record<CleanupDisplayCategory, ScanItem[]> {
  const grouped = Object.fromEntries(
    CLEANUP_DISPLAY_CATEGORY_ORDER.map((cat) => [cat, [] as ScanItem[]])
  ) as Record<CleanupDisplayCategory, ScanItem[]>

  for (const item of items) {
    const category = resolveCleanupDisplayCategory(item, options)
    grouped[category].push(item)
  }
  return grouped
}

export function firstDisplayCategoryWithItems(
  items: ScanItem[],
  options?: { agentReviewing?: boolean }
): CleanupDisplayCategory {
  const grouped = groupItemsByDisplayCategory(items, options)
  return CLEANUP_DISPLAY_CATEGORY_ORDER.find((cat) => grouped[cat].length > 0) ?? 'recommended-clean'
}

export function isCleanupActionBatchDeletable(action: CleanupActionKind): boolean {
  return action === 'delete-trash'
}

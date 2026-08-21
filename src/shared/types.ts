export type Category = 'safe' | 'recommended' | 'dangerous'

export type ScanMode = 'quick' | 'full'

export type ReclaimState = 'pending' | 'reclaimed' | 'unknown'
export type RecoveryMode = 'recycle-bin' | 'none' | 'native-managed'

export type ContentType =
  | 'system-temp'
  | 'browser-cache'
  | 'app-cache'
  | 'app-logs'
  | 'download-leftover'
  | 'recycle-bin'
  | 'install-leftover'
  | 'large-file'
  | 'large-dir'
  | 'user-data'
  | 'system-protected'
  | 'developer'
  | 'agent'
  | 'game'
  | 'chat'

export type CleanupStrategy = 'trash' | 'delete-contents' | 'delete-files'

export interface RuleConfig {
  id: string
  name: string
  category: Category
  contentType?: ContentType
  paths: string[]
  patterns?: string[]
  subdirs?: string[]
  globDirs?: string[]
  maxDepth?: number
  maxAgeDays?: number
  defaultChecked: boolean
  description?: string
  reason?: string
  impact?: string
  rebuildable?: boolean
  cleanupStrategy?: CleanupStrategy
  deletable?: boolean
  nativeManaged?: boolean
}

export interface RuleWithMeta extends RuleConfig {
  enabled: boolean
  source: 'builtin' | 'custom'
}

export interface RulesBundle {
  protectedPaths: string[]
  protectedLabels: Record<string, string>
  rules: RuleConfig[]
}

export interface UserRulesState {
  disabledRuleIds: string[]
  customRules: RuleConfig[]
}

export interface ScanProgress {
  mode: ScanMode
  label: string
  category: Category
  status: 'scanning' | 'done'
  current: number
  total: number
  categoryCurrent: number
  categoryTotal: number
  ruleId?: string
  ruleName?: string
}

export type EntryKind = 'file' | 'directory'

export interface ScanItem {
  id: string
  ruleId: string
  ruleName: string
  category: Category
  contentType: ContentType
  drive: string
  path: string
  size: number
  sizeIsEstimate: boolean
  sizePartial?: boolean
  snapshotComplete: boolean
  entryKind: EntryKind
  mtimeMs?: number
  deletable: boolean
  autoSelect: boolean
  source: 'rule' | 'analyzer'
  parentTarget?: string
  description?: string
  reason?: string
  impact?: string
  rebuildable?: boolean
  recoveryMode?: RecoveryMode
  ruleSource?: 'builtin' | 'custom'
}

export type ScanCandidate = ScanItem

export interface ScanRequest {
  drive?: string
  mode?: ScanMode
}

export interface ScanResult {
  sessionId: string
  drive: string
  mode: ScanMode
  items: ScanItem[]
  errors: ScanError[]
  cancelled?: boolean
  totalSize: number
  scannedAt: string
}

export interface ScanError {
  ruleId: string
  path: string
  message: string
}

export interface CleanupAction {
  candidateId: string
  ruleId: string
  target: string
  operation: 'trash'
  estimatedLogicalBytes: number
}

export interface CleanupPlan {
  id: string
  actions: CleanupAction[]
  estimatedLogicalBytes: number
  riskSummary: Record<Category, number>
  createdAt: number
}

export interface CleanupRequest {
  sessionId: string
  candidateIds: string[]
}

export interface CleanupError {
  path: string
  message: string
  code?: string
}

export interface CleanupResult {
  planId: string
  estimatedLogicalBytes: number
  movedToTrashBytes: number
  actuallyReclaimedBytes: number
  reclaimState: ReclaimState
  recoveryMode: RecoveryMode
  moved: number
  skipped: number
  failed: number
  succeeded: string[]
  errors: CleanupError[]
  rejected: Array<{ path: string; reason: string }>
}

export const CATEGORY_LABELS: Record<Category, string> = {
  safe: '建议清理',
  recommended: '谨慎处理',
  dangerous: '仅分析'
}

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  safe: '明确缓存 / 临时文件，规则精确匹配',
  recommended: '可重建但有成本，默认不勾选',
  dangerous: '用户 / 系统 / 状态数据，只分析不删除'
}

export const CATEGORY_ORDER: Category[] = ['safe', 'recommended', 'dangerous']

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  'system-temp': '系统临时文件',
  'browser-cache': '浏览器缓存',
  'app-cache': '应用缓存',
  'app-logs': '应用日志',
  'download-leftover': '下载残留',
  'recycle-bin': '回收站',
  'install-leftover': '安装残留',
  'large-file': '大型文件',
  'large-dir': '大型目录',
  'user-data': '用户数据',
  'system-protected': '系统受保护数据',
  developer: '开发工具',
  agent: 'AI / Agent',
  game: '游戏',
  chat: '聊天软件'
}

export const SCAN_MODE_LABELS: Record<ScanMode, string> = {
  quick: '安全清理',
  full: '空间分析'
}

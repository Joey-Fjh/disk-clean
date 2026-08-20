export type Category = 'safe' | 'recommended' | 'dangerous'

export type ScanMode = 'quick' | 'full'

/** 按数据性质分类（产品核心） */
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
  /** 兼容旧 UI 字段 */
  ruleId?: string
  ruleName?: string
}

export interface ScanItem {
  id: string
  ruleId: string
  ruleName: string
  category: Category
  contentType: ContentType
  path: string
  size: number
  deletable: boolean
  source: 'rule' | 'analyzer'
  description?: string
  reason?: string
  impact?: string
  rebuildable?: boolean
}

export interface ScanResult {
  mode: ScanMode
  items: ScanItem[]
  errors: ScanError[]
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
  estimatedBytes: number
}

export interface CleanupPlan {
  id: string
  actions: CleanupAction[]
  estimatedBytes: number
  riskSummary: Record<Category, number>
  createdAt: number
}

export interface CleanupRequestItem {
  id: string
  ruleId: string
  path: string
  size: number
  category: Category
  deletable: boolean
}

export interface CleanupRequest {
  items: CleanupRequestItem[]
}

export interface CleanupError {
  path: string
  message: string
  code?: string
}

export interface CleanupResult {
  planId: string
  freedBytes: number
  deleted: number
  skipped: number
  failed: number
  succeeded: string[]
  errors: CleanupError[]
  rejected: Array<{ path: string; reason: string }>
}

export const CATEGORY_LABELS: Record<Category, string> = {
  safe: '低风险',
  recommended: '需确认',
  dangerous: '仅查看'
}

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  safe: '明确缓存 / 临时文件，一般可放心清理',
  recommended: '可重新生成，但可能有使用成本',
  dangerous: '用户数据 / 系统数据 / 状态数据，只展示不删除'
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
  quick: '快速扫描',
  full: '空间分析'
}

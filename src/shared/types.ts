export type Category = 'safe' | 'recommended' | 'dangerous'

export type ScanMode = 'quick' | 'full' | 'combined'

export type ScanPhase = 'space-discovery' | 'rule-identification'

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
  phase?: ScanPhase
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

export type DiscoverySource = 'space-scan' | 'rule' | 'local-feature' | 'agent'

export type JudgmentStatus = 'pending' | 'suggested' | 'caution' | 'keep' | 'uncertain'

export type JudgmentSource = 'legacy-rule' | 'agent' | 'local-policy' | 'none'

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown'

export type SuggestedAction = 'recycle' | 'delete-file' | 'delete-directory-contents' | 'none'

export interface CandidateEvidence {
  source: DiscoverySource
  summary: string
  ruleId?: string
  ruleName?: string
}

export interface CandidateJudgment {
  status: JudgmentStatus
  source: JudgmentSource
  confidence: ConfidenceLevel
  basis: string[]
}

export interface CandidateSelection {
  selectable: boolean
  notSelectableReason?: string
}

/** 空间占用观察（展示用）；与 rule-backed 执行快照分离。 */
export interface OccupancyObservation {
  size: number
  sizePartial?: boolean
  snapshotComplete: boolean
  mtimeMs?: number
  entryKind: EntryKind
  source: 'space-scan'
}

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
  /** 发现来源（可多项）；legacy `source` 仅表示主来源。 */
  discoverySources: DiscoverySource[]
  /** 可展示的证据摘要。 */
  evidence: CandidateEvidence[]
  /** Agent / 规则 / 本地策略判断结果。 */
  judgment: CandidateJudgment
  /** Agent 单轮分析展示字段（不含路径或执行授权）。 */
  agentInsight?: {
    likelyContent: string
    reason: string
    impact: string
  }
  /** 用户是否可勾选清理。 */
  selection: CandidateSelection
  /** 建议的受限清理动作（白名单；本阶段不扩展 Cleaner）。 */
  suggestedAction: SuggestedAction
  /** 空间占用观察；rule-backed 合并项的执行字段不得取自此处。 */
  occupancyObservation?: OccupancyObservation
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

export const CANDIDATE_TAB_LABELS: Record<Category, string> = {
  safe: '建议清理',
  recommended: '谨慎处理',
  dangerous: '待判断 / 不建议'
}

/** @deprecated 使用 CANDIDATE_TAB_LABELS；保留别名避免外部引用断裂 */
export const CATEGORY_LABELS = CANDIDATE_TAB_LABELS

export const RULE_CATEGORY_LABELS: Record<Category, string> = {
  safe: '建议清理规则',
  recommended: '谨慎处理规则',
  dangerous: '仅展示 / 禁止清理规则'
}

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  safe: '明确缓存 / 临时文件，规则精确匹配',
  recommended: '可重建但有成本，默认不勾选',
  dangerous: '等待判断或不建议清理；当前版本空间发现项显示为待判断，尚未启用智能判断'
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
  agent: 'AI 工具缓存',
  game: '游戏',
  chat: '聊天软件'
}

export const SCAN_MODE_LABELS: Record<ScanMode, string> = {
  quick: '安全清理',
  full: '空间分析',
  combined: '统一扫描'
}

export const SCAN_PHASE_LABELS: Record<ScanPhase, string> = {
  'space-discovery': '空间发现',
  'rule-identification': '规则识别'
}

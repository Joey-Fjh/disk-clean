import type {
  CleanupRequest,
  CleanupResult,
  RuleWithMeta,
  ScanMode,
  ScanProgress,
  ScanResult
} from '../shared/types'

export interface DiskCleanAPI {
  startScan: (mode: ScanMode) => Promise<ScanResult>
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void
  executeCleanup: (request: CleanupRequest) => Promise<CleanupResult>
  listRules: () => Promise<RuleWithMeta[]>
  setRuleEnabled: (ruleId: string, enabled: boolean) => Promise<RuleWithMeta[]>
  removeRule: (ruleId: string) => Promise<{ removed: boolean; rules: RuleWithMeta[] }>
  resetRules: () => Promise<RuleWithMeta[]>
  importRules: () => Promise<{ imported: number; rules: RuleWithMeta[] }>
  openInExplorer: (targetPath: string) => Promise<void>
}

declare global {
  interface Window {
    diskClean: DiskCleanAPI
  }
}

export {}

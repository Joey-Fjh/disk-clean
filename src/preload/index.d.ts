import type {
  CleanupRequest,
  CleanupResult,
  RuleWithMeta,
  ScanItem,
  ScanProgress,
  ScanRequest,
  ScanResult
} from '../shared/types'

export interface DiskCleanAPI {
  listDrives: () => Promise<string[]>
  startScan: (request: ScanRequest) => Promise<ScanResult>
  cancelScan: () => Promise<void>
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void
  onScanItems: (callback: (items: ScanItem[]) => void) => () => void
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

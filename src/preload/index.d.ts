import type {
  ProviderConfigPublic,
  ProviderTestResult,
  SaveProviderConfigInput
} from '../shared/provider-types'
import type { AgentAnalyzeRequest, AgentAnalyzeResult } from '../shared/agent-types'
import type {
  InvestigationExecuteToolResult,
  InvestigationPublicStatus,
  InvestigationToolRequest
} from '../shared/investigation-types'
import type {
  AgentGenerateRuleDraftRequest,
  AgentGenerateRuleDraftResult,
  CoreSafetyPolicy,
  RuleDraftPreviewResult,
  StoredRuleDraft
} from '../shared/rule-layer-types'
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
  importRules: () => Promise<{ imported: number; rules: RuleWithMeta[]; draftOnly?: boolean }>
  openInExplorer: (targetPath: string) => Promise<void>
  getProviderConfig: () => Promise<ProviderConfigPublic | null>
  saveProviderConfig: (input: SaveProviderConfigInput) => Promise<ProviderConfigPublic>
  deleteProviderApiKey: () => Promise<ProviderConfigPublic | null>
  testProviderConnection: () => Promise<ProviderTestResult>
  testProviderCapability: () => Promise<ProviderTestResult>
  analyzeScan: (request: AgentAnalyzeRequest) => Promise<AgentAnalyzeResult>
  getInvestigationStatus: (sessionId: string) => Promise<InvestigationPublicStatus>
  startInvestigation: (sessionId: string) => Promise<InvestigationPublicStatus>
  cancelInvestigation: (sessionId: string) => Promise<InvestigationPublicStatus>
  executeInvestigationTool: (request: InvestigationToolRequest) => Promise<InvestigationExecuteToolResult>
  generateRuleDraft: (request: AgentGenerateRuleDraftRequest) => Promise<AgentGenerateRuleDraftResult>
  cancelRuleDraft: () => Promise<boolean>
  listRulePacks: () => Promise<
    Array<import('../shared/rule-layer-types').RulePackManifest & { enabled: boolean; ruleCount: number }>
  >
  setRulePackEnabled: (packId: string, enabled: boolean) => Promise<boolean>
  listRuleDrafts: () => Promise<StoredRuleDraft[]>
  previewRuleDraft: (draftId: string, sessionId?: string) => Promise<RuleDraftPreviewResult>
  approveRuleDraft: (
    draftId: string
  ) => Promise<{ ok: boolean; message: string; draft?: StoredRuleDraft }>
  confirmEnableRuleDraft: (
    draftId: string
  ) => Promise<{ ok: boolean; message: string; code?: string; draft?: StoredRuleDraft }>
  enableRuleDraft: (draftId: string) => Promise<{ ok: boolean; message: string; code?: string }>
  disableRuleDraft: (draftId: string) => Promise<boolean>
  rejectRuleDraft: (draftId: string) => Promise<boolean>
  deleteRuleDraft: (draftId: string) => Promise<boolean>
  importRuleDraft: () => Promise<{ imported: boolean; draft: StoredRuleDraft | null }>
  exportRuleWritingPack: (input: {
    sessionId: string
    candidateIds?: string[]
  }) => Promise<{ exported: boolean }>
  getSafetyPolicy: () => Promise<CoreSafetyPolicy>
  getActiveScanSession: () => Promise<{
    sessionId: string
    fingerprint: string
    drive: string
    candidateCount: number
    revision: number
  } | null>
}

declare global {
  interface Window {
    diskClean: DiskCleanAPI
  }
}

export {}

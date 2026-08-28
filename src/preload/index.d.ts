import type {
  CreateProviderProfileInput,
  ProviderProfilesPublicState,
  ProviderTestResult,
  UpdateProviderProfileInput
} from '../shared/provider-types'
import type { AgentAnalyzeRequest, AgentAnalyzeResult } from '../shared/agent-types'
import type { InvestigationTimelineEvent } from '../shared/investigation-timeline-types'
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
  CleanupExecuteRequest,
  CleanupPlanPreview,
  CleanupPrepareRequest,
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
  getScanSessionInfo: () => Promise<{
    sessionId: string
    fingerprint: string
    drive: string
    candidateCount: number
    revision: number
  } | null>
  prepareCleanup: (request: CleanupPrepareRequest) => Promise<CleanupPlanPreview>
  executeConfirmedCleanup: (request: CleanupExecuteRequest) => Promise<CleanupResult>
  listRules: () => Promise<RuleWithMeta[]>
  setRuleEnabled: (ruleId: string, enabled: boolean) => Promise<RuleWithMeta[]>
  removeRule: (ruleId: string) => Promise<{ removed: boolean; rules: RuleWithMeta[] }>
  resetRules: () => Promise<RuleWithMeta[]>
  importRules: () => Promise<{ imported: number; rules: RuleWithMeta[]; draftOnly?: boolean }>
  openInExplorer: (targetPath: string) => Promise<void>
  listProviderProfiles: () => Promise<ProviderProfilesPublicState>
  createProviderProfile: (input: CreateProviderProfileInput) => Promise<ProviderProfilesPublicState>
  updateProviderProfile: (input: UpdateProviderProfileInput) => Promise<ProviderProfilesPublicState>
  deleteProviderProfile: (profileId: string) => Promise<ProviderProfilesPublicState>
  setActiveProviderProfile: (profileId: string) => Promise<ProviderProfilesPublicState>
  testProviderConnection: (profileId: string) => Promise<ProviderTestResult>
  testProviderCapability: (profileId: string) => Promise<ProviderTestResult>
  analyzeScan: (request: AgentAnalyzeRequest) => Promise<AgentAnalyzeResult>
  cancelAgentAnalysis: () => Promise<boolean>
  onInvestigationTimeline: (callback: (event: InvestigationTimelineEvent) => void) => () => void
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
  updateRuleDraft: (draftId: string, patch: Record<string, unknown>) => Promise<StoredRuleDraft>
  copyBuiltInRuleAsDraft: (ruleId: string) => Promise<StoredRuleDraft>
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

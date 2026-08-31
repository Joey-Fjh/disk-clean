import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateProviderProfileInput,
  ProviderErrorCode,
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
import type { CreateUserExperienceInput, UpdateUserExperienceInput, UserExperienceEntry } from '../shared/user-experience-types'
import type { AgentIpcResult } from '../shared/agent-ipc'
import type { CleanupIpcResult } from '../shared/cleanup-ipc'
import type { ProviderIpcResult } from '../shared/provider-ipc'
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

export class ProviderInvokeError extends Error {
  readonly code: ProviderErrorCode

  constructor(code: ProviderErrorCode, message: string) {
    super(message)
    this.name = 'ProviderInvokeError'
    this.code = code
  }
}

export class AgentInvokeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentInvokeError'
    this.code = code
  }
}

async function invokeAgentIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as AgentIpcResult<T>
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new AgentInvokeError('INVALID_INPUT', 'Agent IPC 响应无效')
  }
  if (!result.ok) {
    throw new AgentInvokeError(result.code, result.message)
  }
  return result.value
}

export class CleanupInvokeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CleanupInvokeError'
    this.code = code
  }
}

async function invokeCleanupIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as CleanupIpcResult<T>
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new CleanupInvokeError('INVALID_INPUT', 'Cleanup IPC 响应无效')
  }
  if (!result.ok) {
    throw new CleanupInvokeError(result.code, result.message)
  }
  return result.value
}

async function invokeProviderIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as ProviderIpcResult<T>
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new ProviderInvokeError('INVALID_INPUT', 'Provider IPC 响应无效')
  }
  if (!result.ok) {
    throw new ProviderInvokeError(result.code, result.message)
  }
  return result.value
}

contextBridge.exposeInMainWorld('diskClean', {
  listDrives: (): Promise<string[]> => ipcRenderer.invoke('system:listDrives'),
  startScan: (request: ScanRequest): Promise<ScanResult> => ipcRenderer.invoke('scan:start', request),
  cancelScan: (): Promise<void> => ipcRenderer.invoke('scan:cancel'),
  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => callback(progress)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },
  onScanItems: (callback: (items: ScanItem[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, items: ScanItem[]) => callback(items)
    ipcRenderer.on('scan:items', handler)
    return () => ipcRenderer.removeListener('scan:items', handler)
  },
  getScanSessionInfo: (): Promise<{
    sessionId: string
    fingerprint: string
    drive: string
    candidateCount: number
    revision: number
  } | null> => ipcRenderer.invoke('scan:get-session-info'),
  prepareCleanup: (request: CleanupPrepareRequest): Promise<CleanupPlanPreview> =>
    invokeCleanupIpc('cleanup:prepare', request),
  executeConfirmedCleanup: (request: CleanupExecuteRequest): Promise<CleanupResult> =>
    invokeCleanupIpc('cleanup:execute', request),
  listRules: (): Promise<RuleWithMeta[]> => ipcRenderer.invoke('rules:list'),
  setRuleEnabled: (ruleId: string, enabled: boolean): Promise<RuleWithMeta[]> =>
    ipcRenderer.invoke('rules:setEnabled', ruleId, enabled),
  removeRule: (ruleId: string): Promise<{ removed: boolean; rules: RuleWithMeta[] }> =>
    ipcRenderer.invoke('rules:remove', ruleId),
  resetRules: (): Promise<RuleWithMeta[]> => ipcRenderer.invoke('rules:reset'),
  importRules: (): Promise<{ imported: number; rules: RuleWithMeta[] }> =>
    ipcRenderer.invoke('rules:import'),
  openInExplorer: (targetPath: string): Promise<void> => ipcRenderer.invoke('path:open', targetPath),
  listProviderProfiles: (): Promise<ProviderProfilesPublicState> =>
    invokeProviderIpc<ProviderProfilesPublicState>('provider:listProfiles'),
  createProviderProfile: (input: CreateProviderProfileInput): Promise<ProviderProfilesPublicState> =>
    invokeProviderIpc<ProviderProfilesPublicState>('provider:createProfile', input),
  updateProviderProfile: (input: UpdateProviderProfileInput): Promise<ProviderProfilesPublicState> =>
    invokeProviderIpc<ProviderProfilesPublicState>('provider:updateProfile', input),
  deleteProviderProfile: (profileId: string): Promise<ProviderProfilesPublicState> =>
    invokeProviderIpc<ProviderProfilesPublicState>('provider:deleteProfile', { profileId }),
  setActiveProviderProfile: (profileId: string): Promise<ProviderProfilesPublicState> =>
    invokeProviderIpc<ProviderProfilesPublicState>('provider:setActiveProfile', { profileId }),
  testProviderConnection: (profileId: string): Promise<ProviderTestResult> =>
    invokeProviderIpc<ProviderTestResult>('provider:testConnection', { profileId }),
  testProviderCapability: (profileId: string): Promise<ProviderTestResult> =>
    invokeProviderIpc<ProviderTestResult>('provider:testCapability', { profileId }),
  analyzeScan: (request: AgentAnalyzeRequest): Promise<AgentAnalyzeResult> =>
    invokeAgentIpc<AgentAnalyzeResult>('agent:analyze', request),
  cancelAgentAnalysis: (): Promise<boolean> => invokeAgentIpc<boolean>('agent:cancel-analysis'),
  onInvestigationTimeline: (callback: (event: InvestigationTimelineEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, timelineEvent: InvestigationTimelineEvent) =>
      callback(timelineEvent)
    ipcRenderer.on('agent:investigation-timeline', handler)
    return () => ipcRenderer.removeListener('agent:investigation-timeline', handler)
  },
  getInvestigationStatus: (sessionId: string): Promise<InvestigationPublicStatus> =>
    invokeAgentIpc<InvestigationPublicStatus>('agent:investigation-status', { sessionId }),
  startInvestigation: (sessionId: string): Promise<InvestigationPublicStatus> =>
    invokeAgentIpc<InvestigationPublicStatus>('agent:investigation-start', { sessionId }),
  cancelInvestigation: (sessionId: string): Promise<InvestigationPublicStatus> =>
    invokeAgentIpc<InvestigationPublicStatus>('agent:investigation-cancel', { sessionId }),
  executeInvestigationTool: (
    request: InvestigationToolRequest
  ): Promise<InvestigationExecuteToolResult> =>
    invokeAgentIpc<InvestigationExecuteToolResult>('agent:investigation-execute-tool', request),
  generateRuleDraft: (request: AgentGenerateRuleDraftRequest): Promise<AgentGenerateRuleDraftResult> =>
    invokeAgentIpc<AgentGenerateRuleDraftResult>('agent:generate-rule-draft', request),
  cancelRuleDraft: (): Promise<boolean> => invokeAgentIpc<boolean>('agent:cancel-rule-draft'),
  listRulePacks: (): Promise<
    Array<import('../shared/rule-layer-types').RulePackManifest & { enabled: boolean; ruleCount: number }>
  > => invokeAgentIpc('rules:listPacks'),
  setRulePackEnabled: (packId: string, enabled: boolean): Promise<boolean> =>
    invokeAgentIpc<boolean>('rules:setPackEnabled', packId, enabled),
  listRuleDrafts: (): Promise<StoredRuleDraft[]> => invokeAgentIpc('rules:listDrafts'),
  previewRuleDraft: (draftId: string, sessionId?: string): Promise<RuleDraftPreviewResult> =>
    invokeAgentIpc('rules:previewDraft', draftId, sessionId),
  approveRuleDraft: (
    draftId: string
  ): Promise<{ ok: boolean; message: string; draft?: StoredRuleDraft }> =>
    invokeAgentIpc('rules:approveDraft', draftId),
  confirmEnableRuleDraft: (
    draftId: string
  ): Promise<{ ok: boolean; message: string; code?: string; draft?: StoredRuleDraft }> =>
    invokeAgentIpc('rules:confirmEnableDraft', draftId),
  enableRuleDraft: (draftId: string): Promise<{ ok: boolean; message: string; code?: string }> =>
    invokeAgentIpc('rules:enableDraft', draftId),
  disableRuleDraft: (draftId: string): Promise<boolean> => invokeAgentIpc('rules:disableDraft', draftId),
  rejectRuleDraft: (draftId: string): Promise<boolean> => invokeAgentIpc('rules:rejectDraft', draftId),
  deleteRuleDraft: (draftId: string): Promise<boolean> => invokeAgentIpc('rules:deleteDraft', draftId),
  importRuleDraft: (): Promise<{ imported: boolean; draft: StoredRuleDraft | null }> =>
    invokeAgentIpc('rules:importDraft'),
  updateRuleDraft: (draftId: string, patch: Record<string, unknown>): Promise<StoredRuleDraft> =>
    invokeAgentIpc('rules:updateDraft', draftId, patch),
  copyBuiltInRuleAsDraft: (ruleId: string): Promise<StoredRuleDraft> =>
    invokeAgentIpc('rules:copyBuiltinAsDraft', ruleId),
  exportRuleWritingPack: (input: {
    sessionId: string
    candidateIds?: string[]
  }): Promise<{ exported: boolean }> => invokeAgentIpc('rules:exportWritingPack', input),
  getSafetyPolicy: (): Promise<CoreSafetyPolicy> => invokeAgentIpc('rules:safetyPolicy'),
  listUserExperiences: (): Promise<UserExperienceEntry[]> => invokeAgentIpc('experience:list'),
  createUserExperience: (input: CreateUserExperienceInput): Promise<UserExperienceEntry> =>
    invokeAgentIpc('experience:create', input),
  updateUserExperience: (input: UpdateUserExperienceInput): Promise<UserExperienceEntry> =>
    invokeAgentIpc('experience:update', input),
  deleteUserExperience: (id: string): Promise<boolean> => invokeAgentIpc('experience:delete', id),
  getActiveScanSession: (): Promise<{
    sessionId: string
    fingerprint: string
    drive: string
    candidateCount: number
  } | null> => invokeAgentIpc('scan:getActiveSession')
})

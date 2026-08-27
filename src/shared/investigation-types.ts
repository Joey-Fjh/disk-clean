import type { InvestigationToolName } from './investigation-limits'

export type InvestigationPhase =
  | 'idle'
  | 'analyzing'
  | 'tool_requested'
  | 'tool_running'
  | 'analyzing_result'
  | 'completed'
  | 'uncertain'
  | 'failed'
  | 'cancelled'
  | 'stale'

export type InvestigationToolEntryKind = 'file' | 'directory' | 'symlink' | 'other'

export interface InvestigationToolRequest {
  sessionId: string
  candidateRef: string
  toolName: InvestigationToolName
  relativePath?: string
  limit?: number
  depth?: number
}

export interface InvestigationChildEntry {
  name: string
  kind: InvestigationToolEntryKind
  size: number
  truncatedName?: boolean
}

export interface InvestigationListChildrenResult {
  tool: 'list_children'
  relativePath: string
  entries: InvestigationChildEntry[]
  truncated: boolean
  untrustedDataNotice: string
}

export interface InvestigationDirectorySummary {
  fileCount: number
  directoryCount: number
  symlinkCount: number
  otherCount: number
  totalBytes: number
  extensionCounts: Record<string, number>
  truncated: boolean
}

export interface InvestigationSummarizeDirectoryResult {
  tool: 'summarize_directory'
  relativePath: string
  summary: InvestigationDirectorySummary
  untrustedDataNotice: string
}

export interface InvestigationSampleNamesResult {
  tool: 'sample_entry_names'
  relativePath: string
  names: string[]
  truncated: boolean
  untrustedDataNotice: string
}

export type InvestigationToolResult =
  | InvestigationListChildrenResult
  | InvestigationSummarizeDirectoryResult
  | InvestigationSampleNamesResult

export interface InvestigationBudgetSnapshot {
  rounds: number
  toolCallsThisRound: number
  totalToolCalls: number
  totalResponseBytes: number
}

export interface InvestigationPublicStatus {
  sessionId: string
  fingerprint: string
  phase: InvestigationPhase
  budget: InvestigationBudgetSnapshot
  lastErrorCode?: string
  lastErrorMessage?: string
  modelId?: string
  conclusionModelId?: string
}

export interface InvestigationExecuteToolResult {
  status: InvestigationPublicStatus
  result?: InvestigationToolResult
  cached: boolean
}

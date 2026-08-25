import type { ScanItem } from './types'

export const AGENT_SCHEMA_VERSION = '1' as const

export type AgentVerdict = 'clean' | 'confirm' | 'keep' | 'uncertain'

export type AgentConfidence = 'high' | 'medium' | 'low'

export interface AgentRecommendation {
  candidateRef: string
  verdict: AgentVerdict
  likelyContent: string
  reason: string
  impact: string
  confidence: AgentConfidence
  basis: string[]
}

export interface AgentModelResponse {
  schemaVersion: typeof AGENT_SCHEMA_VERSION
  summary: {
    headline: string
    overview: string
  }
  recommendations: AgentRecommendation[]
}

export interface AgentCandidateInsight {
  likelyContent: string
  reason: string
  impact: string
}

export type AgentAnalysisStatus =
  | 'idle'
  | 'skipped_no_provider'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale'

export interface AgentAnalysisPublic {
  sessionId: string
  status: AgentAnalysisStatus
  headline?: string
  overview?: string
  analyzedCount: number
  omittedCount: number
  appliedCount: number
  skippedInvalidCount: number
  errorMessage?: string
  requestId?: string
}

export interface AgentAnalyzeResult {
  analysis: AgentAnalysisPublic
  items: ScanItem[]
}

export interface AgentAnalyzeRequest {
  sessionId: string
  retry?: boolean
}

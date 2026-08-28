import type { AgentModelResponse } from './agent-types'
import type { InvestigationToolName } from './investigation-limits'

export const INVESTIGATION_TURN_SCHEMA_VERSION = 1 as const

export type InvestigationTurnAction = 'investigate' | 'final'

export interface InvestigationToolCall {
  candidateRef: string
  tool: InvestigationToolName
  relativePath?: string
  depth?: number
  limit?: number
}

export interface InvestigationInvestigateTurn {
  schemaVersion: typeof INVESTIGATION_TURN_SCHEMA_VERSION
  action: 'investigate'
  purpose: string
  calls: InvestigationToolCall[]
}

export interface InvestigationFinalTurn {
  schemaVersion: typeof INVESTIGATION_TURN_SCHEMA_VERSION
  action: 'final'
  result: AgentModelResponse
}

export type InvestigationTurn = InvestigationInvestigateTurn | InvestigationFinalTurn

export interface InvestigationToolResultMessage {
  candidateRef: string
  tool: InvestigationToolName
  ok: boolean
  cached?: boolean
  truncated?: boolean
  summary?: string
  errorCode?: string
  errorMessage?: string
  data?: unknown
}

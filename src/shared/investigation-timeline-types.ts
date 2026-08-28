import type { InvestigationToolName } from './investigation-limits'

export const INVESTIGATION_TIMELINE_SCHEMA_VERSION = 1 as const
export const MAX_INVESTIGATION_TIMELINE_ENTRIES = 48
export const MAX_INVESTIGATION_TIMELINE_TEXT = 256

export type InvestigationTimelineEventType =
  | 'investigation_started'
  | 'model_analyzing'
  | 'tool_requested'
  | 'tool_completed'
  | 'planning'
  | 'completed'
  | 'uncertain'
  | 'failed'
  | 'cancelled'

export interface InvestigationTimelineEvent {
  schemaVersion: typeof INVESTIGATION_TIMELINE_SCHEMA_VERSION
  type: InvestigationTimelineEventType
  sessionId: string
  generation: string
  at: number
  message: string
  candidateRef?: string
  tool?: InvestigationToolName
  itemCount?: number
  byteCount?: number
  truncated?: boolean
  cached?: boolean
}

export interface InvestigationSummary {
  generation: string
  roundCount: number
  toolCallCount: number
  cacheHitCount: number
  uncertain: boolean
  timeline: InvestigationTimelineEvent[]
}

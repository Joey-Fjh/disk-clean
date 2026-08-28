import type { AgentAnalysisStatus } from '../shared/agent-types'
import type { ScanPhase } from '../shared/types'
import {
  type CleanupTaskPhase,
  type CleanupTaskProgressInput,
  isCleanupTaskInProgress,
  mapScanPhaseToCleanupTaskPhase,
  resolveCleanupTaskHeadline,
  resolveCleanupTaskSubline
} from '../shared/cleanup-task-model'

export type ScanTaskPhase = CleanupTaskPhase

export interface ScanTaskStateInput extends CleanupTaskProgressInput {}

export { isCleanupTaskInProgress, mapScanPhaseToCleanupTaskPhase }

export function resolveScanTaskHeadline(input: ScanTaskStateInput): string {
  return resolveCleanupTaskHeadline(input)
}

export function mapScanProgressPhaseToTaskPhase(
  scanning: boolean,
  scanPhase?: ScanPhase,
  agentReviewing?: boolean
): ScanTaskPhase {
  return mapScanPhaseToCleanupTaskPhase(scanning, scanPhase, agentReviewing)
}

/** Preserve post-cleanup rescan phase when scan progress events arrive. */
export function resolveScanProgressTaskPhase(input: {
  currentPhase: CleanupTaskPhase
  isPostCleanupRescan: boolean
  scanPhase?: ScanPhase
  agentReviewing?: boolean
}): ScanTaskPhase {
  if (input.currentPhase === 'rescanning' || input.isPostCleanupRescan) {
    return 'rescanning'
  }
  return mapScanProgressPhaseToTaskPhase(true, input.scanPhase, input.agentReviewing)
}

export function resolveScanTaskSubline(input: ScanTaskStateInput): string {
  return resolveCleanupTaskSubline(input)
}

export function isScanningJudgmentPending(status: string): boolean {
  return status === 'identifying' || status === 'pending'
}

export function mapAgentStatusToTaskPhase(
  agentStatus: AgentAnalysisStatus | undefined,
  scanning: boolean
): ScanTaskPhase {
  if (scanning) return mapScanProgressPhaseToTaskPhase(true)
  if (agentStatus === 'running') return 'analyzing'
  if (agentStatus === 'failed') return 'failed'
  if (
    agentStatus === 'completed' ||
    agentStatus === 'skipped_no_provider' ||
    agentStatus === 'cancelled'
  ) {
    return 'completed'
  }
  return 'idle'
}

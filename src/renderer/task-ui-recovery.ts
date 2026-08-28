import type { CleanupTaskPhase } from '../shared/cleanup-task-model'

export interface InteractiveTaskUiState {
  phase: CleanupTaskPhase
  progressHidden: boolean
}

export function resolveInteractiveTaskRecovery(
  itemCount: number,
  phase: CleanupTaskPhase = 'completed'
): InteractiveTaskUiState {
  return {
    phase,
    progressHidden: true
  }
}

export function resolveScanFailureRecovery(isPostCleanupRescan: boolean): InteractiveTaskUiState {
  return {
    phase: isPostCleanupRescan ? 'completed' : 'idle',
    progressHidden: true
  }
}

import type { CleanupTaskPhase } from '../shared/cleanup-task-model'
import type { CleanupDisplayCategory } from '../shared/cleanup-display-category'
import type { ScanItem } from '../shared/types'
import type { CleanupOutcomeManifest, CleanupRescanComparison } from './cleanup-result-state'

export interface InteractiveTaskUiState {
  phase: CleanupTaskPhase
  progressHidden: boolean
}

export interface PendingFinalResults {
  items: ScanItem[]
  phase: CleanupTaskPhase
  presentationGeneration: number
  sessionId?: string
  advanceSuggest?: boolean
  outcomeManifest?: CleanupOutcomeManifest | null
  rescanComparison?: CleanupRescanComparison
}

let pendingFinalResults: PendingFinalResults | null = null
let scanPresentationGeneration = 0

export function beginScanPresentationCycle(): number {
  scanPresentationGeneration += 1
  pendingFinalResults = null
  return scanPresentationGeneration
}

export function getScanPresentationGeneration(): number {
  return scanPresentationGeneration
}

function isPendingPresentationCurrent(pending: PendingFinalResults): boolean {
  return pending.presentationGeneration === scanPresentationGeneration
}

export function queuePendingFinalResults(pending: PendingFinalResults): boolean {
  if (!isPendingPresentationCurrent(pending)) {
    return false
  }
  pendingFinalResults = pending
  return true
}

export function takePendingFinalResults(): PendingFinalResults | null {
  const pending = pendingFinalResults
  pendingFinalResults = null
  return pending
}

export function hasPendingFinalResults(): boolean {
  return pendingFinalResults !== null
}

export function resetPendingFinalResults(): void {
  pendingFinalResults = null
}

export function resetScanPresentationState(): void {
  scanPresentationGeneration = 0
  pendingFinalResults = null
}

export function resolveResultCategoryOrder(input: {
  scanning: boolean
  agentReviewing: boolean
  allCategories: readonly CleanupDisplayCategory[]
}): CleanupDisplayCategory[] {
  return input.allCategories.filter((category) => {
    if (category === 'identifying' || category === 'analyzing') {
      return input.scanning || input.agentReviewing
    }
    return true
  })
}

export function runScanTeardown(input: {
  setScanning: (value: boolean) => void
  presentFinalResults: (pending: PendingFinalResults) => void
  refreshFailureUi?: () => void
  scanFailed: boolean
}): boolean {
  input.setScanning(false)
  return presentPendingFinalResults(input.presentFinalResults, {
    refreshFailureUi: input.refreshFailureUi,
    scanFailed: input.scanFailed
  })
}

export function presentPendingFinalResults(
  presentFinalResults: (pending: PendingFinalResults) => void,
  options: { refreshFailureUi?: () => void; scanFailed?: boolean } = {}
): boolean {
  const pending = takePendingFinalResults()
  if (pending) {
    if (!isPendingPresentationCurrent(pending)) {
      return false
    }
    presentFinalResults(pending)
    return true
  }
  if (options.scanFailed) {
    options.refreshFailureUi?.()
  }
  return false
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

import type { CleanupOutcomeManifest } from './cleanup-result-state'
import { formatPostCleanupRescanStatus, type PostCleanupRescanState } from './cleanup-rescan-lifecycle'

export interface PostCleanupRescanSession {
  state: PostCleanupRescanState
  /** 清理完成后的原始摘要，不含重扫失败/停止后缀。 */
  baseCleanupOutcomeSummary: string | null
  cleanupOutcomeSummary: string | null
  pendingCleanupOutcome: CleanupOutcomeManifest | null
  rescanDrive: string | null
  inFlight: boolean
}

export function createPostCleanupRescanSession(): PostCleanupRescanSession {
  return {
    state: 'idle',
    baseCleanupOutcomeSummary: null,
    cleanupOutcomeSummary: null,
    pendingCleanupOutcome: null,
    rescanDrive: null,
    inFlight: false
  }
}

export function isPostCleanupRescanActive(session: PostCleanupRescanSession): boolean {
  return session.state === 'rescanning'
}

export function canRetryPostCleanupRescan(session: PostCleanupRescanSession): boolean {
  return (
    (session.state === 'rescan-failed' || session.state === 'rescan-cancelled') &&
    session.pendingCleanupOutcome !== null &&
    session.baseCleanupOutcomeSummary !== null &&
    !session.inFlight
  )
}

export function resolvePersistentCleanupStatusText(session: PostCleanupRescanSession): string | null {
  const summary = session.baseCleanupOutcomeSummary ?? session.cleanupOutcomeSummary
  if (!summary) return null
  if (
    session.state === 'rescanning' ||
    session.state === 'rescan-completed' ||
    session.state === 'rescan-failed' ||
    session.state === 'rescan-cancelled'
  ) {
    if (session.state === 'rescan-completed' && session.cleanupOutcomeSummary) {
      return session.cleanupOutcomeSummary
    }
    return formatPostCleanupRescanStatus(session.state, summary)
  }
  return null
}

export function resolveScanInitializationStatusText(
  session: PostCleanupRescanSession,
  ordinaryScanText: string
): string {
  return resolvePersistentCleanupStatusText(session) ?? ordinaryScanText
}

export function beginPostCleanupRescanSession(
  session: PostCleanupRescanSession,
  input: {
    cleanupOutcomeSummary: string
    pendingCleanupOutcome: CleanupOutcomeManifest
    drive: string
  }
): PostCleanupRescanSession {
  return {
    ...session,
    state: 'rescanning',
    baseCleanupOutcomeSummary: input.cleanupOutcomeSummary,
    cleanupOutcomeSummary: input.cleanupOutcomeSummary,
    pendingCleanupOutcome: input.pendingCleanupOutcome,
    rescanDrive: input.drive,
    inFlight: true
  }
}

export function markPostCleanupRescanIdle(session: PostCleanupRescanSession): PostCleanupRescanSession {
  return { ...session, inFlight: false }
}

export function abandonPostCleanupRescanContext(
  session: PostCleanupRescanSession
): PostCleanupRescanSession {
  return {
    state: 'idle',
    baseCleanupOutcomeSummary: null,
    cleanupOutcomeSummary: null,
    pendingCleanupOutcome: null,
    rescanDrive: null,
    inFlight: false
  }
}

export function applyPostCleanupRescanFinish(
  session: PostCleanupRescanSession,
  input: { cancelled: boolean; comparisonDetail?: string }
): PostCleanupRescanSession {
  if (session.state !== 'rescanning') {
    return markPostCleanupRescanIdle(session)
  }

  if (input.cancelled) {
    return {
      ...session,
      state: 'rescan-cancelled',
      inFlight: false
    }
  }

  return {
    ...session,
    state: 'rescan-completed',
    cleanupOutcomeSummary: formatPostCleanupRescanStatus(
      'rescan-completed',
      session.baseCleanupOutcomeSummary ?? session.cleanupOutcomeSummary ?? '清理完成',
      input.comparisonDetail
    ),
    pendingCleanupOutcome: null,
    inFlight: false
  }
}

export function applyPostCleanupRescanFailure(
  session: PostCleanupRescanSession,
  detail?: string
): PostCleanupRescanSession {
  const base = session.baseCleanupOutcomeSummary ?? session.cleanupOutcomeSummary
  if (!base) {
    return markPostCleanupRescanIdle({ ...session, state: 'rescan-failed' })
  }
  return {
    ...session,
    state: 'rescan-failed',
    cleanupOutcomeSummary: formatPostCleanupRescanStatus('rescan-failed', base, detail),
    inFlight: false
  }
}

export interface PostCleanupRescanScanOptions {
  drive: string
  confirmRescan: false
  skipAutoAgent: true
}

export function buildPostCleanupRescanScanOptions(
  session: PostCleanupRescanSession
): PostCleanupRescanScanOptions | null {
  if (!session.pendingCleanupOutcome || !session.rescanDrive) return null
  return {
    drive: session.rescanDrive,
    confirmRescan: false,
    skipAutoAgent: true
  }
}

export function shouldSkipAutoAgentForScan(
  session: PostCleanupRescanSession,
  skipAutoAgentOption?: boolean
): boolean {
  return skipAutoAgentOption === true || isPostCleanupRescanActive(session)
}

export interface ScanPreflightPlan {
  needsAbandonRescanConfirm: boolean
  needsClearSelectionConfirm: boolean
  combinedConfirm: boolean
}

export function planScanPreflight(
  session: PostCleanupRescanSession,
  input: { isOrdinaryScan: boolean; hasSelectedItems: boolean; confirmRescan?: boolean }
): ScanPreflightPlan {
  const needsAbandonRescanConfirm =
    input.isOrdinaryScan &&
    session.pendingCleanupOutcome !== null &&
    session.state !== 'idle' &&
    session.state !== 'rescan-completed'
  const needsClearSelectionConfirm =
    input.confirmRescan !== false && input.hasSelectedItems
  return {
    needsAbandonRescanConfirm,
    needsClearSelectionConfirm,
    combinedConfirm: needsAbandonRescanConfirm && needsClearSelectionConfirm
  }
}

export function commitScanPreflight(
  session: PostCleanupRescanSession,
  input: { isOrdinaryScan: boolean; skipAutoAgentOption?: boolean }
): { session: PostCleanupRescanSession; skipAutoAgent: boolean } {
  const nextSession = input.isOrdinaryScan ? abandonPostCleanupRescanContext(session) : session
  return {
    session: nextSession,
    skipAutoAgent: shouldSkipAutoAgentForScan(nextSession, input.skipAutoAgentOption)
  }
}

export type PostCleanupRescanLifecycleEvent =
  | { type: 'cleanup-succeeded'; summary: string; manifest: CleanupOutcomeManifest; drive: string }
  | { type: 'start-scan-initialized' }
  | { type: 'scan-finished'; cancelled: boolean; comparisonDetail?: string }
  | { type: 'scan-failed'; detail?: string }
  | { type: 'retry-rescan' }
  | { type: 'ordinary-scan-started' }

export function reducePostCleanupRescanSession(
  session: PostCleanupRescanSession,
  event: PostCleanupRescanLifecycleEvent
): PostCleanupRescanSession {
  switch (event.type) {
    case 'cleanup-succeeded':
      return beginPostCleanupRescanSession(session, {
        cleanupOutcomeSummary: event.summary,
        pendingCleanupOutcome: event.manifest,
        drive: event.drive
      })
    case 'start-scan-initialized':
      return session
    case 'scan-finished':
      return applyPostCleanupRescanFinish(session, {
        cancelled: event.cancelled,
        comparisonDetail: event.comparisonDetail
      })
    case 'scan-failed':
      return applyPostCleanupRescanFailure(session, event.detail)
    case 'retry-rescan':
      if (!canRetryPostCleanupRescan(session)) return session
      return {
        ...session,
        state: 'rescanning',
        cleanupOutcomeSummary: session.baseCleanupOutcomeSummary,
        inFlight: true
      }
    case 'ordinary-scan-started':
      return abandonPostCleanupRescanContext(session)
    default:
      return session
  }
}

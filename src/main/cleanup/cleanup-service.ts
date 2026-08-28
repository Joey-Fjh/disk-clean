import { existsSync } from 'fs'
import type {
  CleanupPlanPreview,
  CleanupPostReview,
  CleanupPrepareRequest,
  CleanupResult
} from '../../shared/types'
import { buildSessionFingerprint } from '../../shared/candidate-ref-index'
import { MAX_CLEANUP_BASIS_SUMMARIES } from '../../shared/cleanup-limits'
import { CLEANUP_ERROR_MESSAGES } from '../../shared/cleanup-errors'
import { getScanSession, updateScanSessionCandidates } from '../scan/scan-session-store'
import { buildCleanupPlanFromCandidates } from './plan-builder'
import { validateCleanupActions } from './safety-validator'
import { executeCleanup } from './cleaner'
import { normalizeCleanupCandidateIds } from './cleanup-request'
export { normalizeCleanupCandidateIds } from './cleanup-request'
import { CleanupServiceError } from './cleanup-errors'
import {
  assertSessionFingerprint,
  authorizeSessionCandidates
} from './session-cleanup-authorizer'
import {
  consumeCleanupConfirmation,
  createCleanupConfirmation
} from './cleanup-confirmation-store'

function emptyResult(skipped: number, rejected: CleanupResult['rejected']): CleanupResult {
  return {
    planId: '',
    estimatedLogicalBytes: 0,
    movedToTrashBytes: 0,
    actuallyReclaimedBytes: 0,
    reclaimState: 'unknown',
    recoveryMode: 'recycle-bin',
    moved: 0,
    skipped,
    failed: 0,
    succeeded: [],
    errors: [],
    rejected
  }
}

function buildBasisSummaries(candidates: Array<{ judgment: { basis: string[] }; ruleName: string }>): string[] {
  const summaries = new Set<string>()
  for (const candidate of candidates) {
    for (const line of candidate.judgment?.basis ?? []) {
      if (line.trim()) summaries.add(line.trim())
    }
    if (summaries.size >= MAX_CLEANUP_BASIS_SUMMARIES) break
  }
  if (summaries.size === 0) {
    return ['基于本地规则或 Agent 复核建议']
  }
  return [...summaries].slice(0, MAX_CLEANUP_BASIS_SUMMARIES)
}

export function prepareCleanupConfirmation(request: CleanupPrepareRequest): CleanupPlanPreview {
  const session = getScanSession(request.sessionId)
  if (!session) {
    throw new CleanupServiceError('SESSION_STALE', CLEANUP_ERROR_MESSAGES.SESSION_STALE)
  }
  if (!assertSessionFingerprint(session, request.fingerprint)) {
    throw new CleanupServiceError('SESSION_STALE', CLEANUP_ERROR_MESSAGES.SESSION_STALE)
  }

  const { uniqueIds, preRejected } = normalizeCleanupCandidateIds(request.candidateIds)
  if (preRejected.length > 0 && uniqueIds.length === 0) {
    throw new CleanupServiceError('INVALID_INPUT', preRejected[0]?.reason ?? CLEANUP_ERROR_MESSAGES.INVALID_INPUT)
  }

  const authResults = authorizeSessionCandidates(session, uniqueIds)
  const approvedCandidates = authResults.filter((entry) => entry.authorized).map((entry) => entry.candidate)
  const rejectedAtPrepare = [
    ...preRejected.map((entry) => ({
      candidateId: entry.path,
      message: entry.reason,
      code: 'INVALID_INPUT' as const
    })),
    ...authResults
      .filter((entry) => !entry.authorized)
      .map((entry) => ({
        candidateId: entry.candidate.id,
        message: entry.message ?? CLEANUP_ERROR_MESSAGES.NOT_AUTHORIZED,
        code: entry.code ?? 'NOT_AUTHORIZED'
      }))
  ]
  const rejected = rejectedAtPrepare.map((entry) => ({
    path: entry.candidateId,
    reason: entry.message,
    code: entry.code
  }))

  if (approvedCandidates.length === 0) {
    throw new CleanupServiceError('NOT_AUTHORIZED', CLEANUP_ERROR_MESSAGES.NOT_AUTHORIZED)
  }

  const built = buildCleanupPlanFromCandidates(approvedCandidates)
  let confirmation
  try {
    confirmation = createCleanupConfirmation({
      sessionId: session.sessionId,
      fingerprint: buildSessionFingerprint(session.sessionId, session.createdAt, session.revision),
      revision: session.revision,
      candidateIds: approvedCandidates.map((candidate) => candidate.id)
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR'
    if (code === 'CONFIRMATION_STORE_FULL') {
      throw new CleanupServiceError('CONFIRMATION_STORE_FULL', CLEANUP_ERROR_MESSAGES.CONFIRMATION_STORE_FULL)
    }
    throw error
  }

  return {
    confirmationId: confirmation.confirmationId,
    itemCount: approvedCandidates.length,
    estimatedLogicalBytes: built.plan.estimatedLogicalBytes,
    recommendedCleanCount: approvedCandidates.filter((item) => item.category === 'safe').length,
    cautionCleanCount: approvedCandidates.filter((item) => item.category === 'recommended').length,
    requiresAppClosedCount: approvedCandidates.filter((item) => item.requiresAppClosed).length,
    basisSummaries: buildBasisSummaries(approvedCandidates),
    rejectedCount: rejected.length,
    approvedCandidateIds: approvedCandidates.map((candidate) => candidate.id),
    rejectedAtPrepare,
    expiresAt: confirmation.expiresAt
  }
}

async function buildPostReview(
  result: Pick<CleanupResult, 'succeeded' | 'failed' | 'errors'>
): Promise<CleanupPostReview> {
  const disappearedPaths: string[] = []
  const stillPresentPaths: string[] = []
  const failedPaths = result.errors.map((entry) => entry.path)

  for (const path of result.succeeded) {
    if (existsSync(path)) {
      stillPresentPaths.push(path)
    } else {
      disappearedPaths.push(path)
    }
  }

  return {
    removedCount: disappearedPaths.length,
    stillPresentCount: stillPresentPaths.length,
    failedCount: result.failed,
    disappearedPaths,
    stillPresentPaths,
    failedPaths
  }
}

export async function executeConfirmedCleanup(confirmationId: string): Promise<CleanupResult> {
  let pending
  try {
    pending = consumeCleanupConfirmation(confirmationId)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'CONFIRMATION_NOT_FOUND'
    if (code === 'CONFIRMATION_EXPIRED') {
      throw new CleanupServiceError('CONFIRMATION_EXPIRED', CLEANUP_ERROR_MESSAGES.CONFIRMATION_EXPIRED)
    }
    if (code === 'CONFIRMATION_ALREADY_USED') {
      throw new CleanupServiceError(
        'CONFIRMATION_ALREADY_USED',
        CLEANUP_ERROR_MESSAGES.CONFIRMATION_ALREADY_USED
      )
    }
    throw new CleanupServiceError('CONFIRMATION_NOT_FOUND', CLEANUP_ERROR_MESSAGES.CONFIRMATION_NOT_FOUND)
  }

  const session = getScanSession(pending.sessionId)
  if (!session) {
    throw new CleanupServiceError('SESSION_STALE', CLEANUP_ERROR_MESSAGES.SESSION_STALE)
  }
  if (!assertSessionFingerprint(session, pending.fingerprint) || session.revision !== pending.revision) {
    throw new CleanupServiceError('SNAPSHOT_STALE', CLEANUP_ERROR_MESSAGES.SNAPSHOT_STALE)
  }

  const candidates = []
  for (const candidateId of pending.candidateIds) {
    const candidate = session.candidates.get(candidateId)
    if (!candidate) {
      throw new CleanupServiceError('CANDIDATE_NOT_FOUND', CLEANUP_ERROR_MESSAGES.CANDIDATE_NOT_FOUND)
    }
    candidates.push(candidate)
  }

  const built = buildCleanupPlanFromCandidates(candidates)
  const { approved, rejected } = await validateCleanupActions(session.sessionId, built.actions)
  if (approved.length === 0) {
    return emptyResult(rejected.length, rejected)
  }

  const result = await executeCleanup(built.plan.id, approved, rejected)
  const postReview = await buildPostReview(result)

  const remaining = [...session.candidates.values()].filter(
    (candidate) => !result.succeeded.includes(candidate.path)
  )
  updateScanSessionCandidates(session.sessionId, remaining)

  const partialFailure = result.failed > 0
  return {
    ...result,
    postReview,
    ...(partialFailure ? {} : {})
  }
}

export async function runCleanupForTests(request: CleanupPrepareRequest): Promise<CleanupResult> {
  const preview = prepareCleanupConfirmation(request)
  return executeConfirmedCleanup(preview.confirmationId)
}

/** @deprecated Phase 6 requires prepare + executeConfirmedCleanup. */
export async function runCleanup(request: {
  sessionId: string
  candidateIds: string[]
}): Promise<CleanupResult> {
  const session = getScanSession(request.sessionId)
  if (!session) {
    const { uniqueIds, preRejected } = normalizeCleanupCandidateIds(request.candidateIds)
    const rejected = [
      ...preRejected,
      ...uniqueIds.map((id) => ({
        path: id,
        reason: CLEANUP_ERROR_MESSAGES.SESSION_STALE,
        code: 'SESSION_STALE'
      }))
    ]
    return emptyResult(rejected.length, rejected)
  }

  return runCleanupForTests({
    sessionId: request.sessionId,
    fingerprint: buildSessionFingerprint(session.sessionId, session.createdAt, session.revision),
    candidateIds: request.candidateIds
  })
}

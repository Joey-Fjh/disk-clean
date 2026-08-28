import { INVESTIGATION_LIMITS, isInvestigationToolName } from '../../../shared/investigation-limits'
import {
  InvestigationValidationError,
  normalizeInvestigationToolRequest,
  rejectUnexpectedDepth,
  rejectUnexpectedLimit,
  validateCandidateRef,
  validateDepth,
  validateListLimit,
  validateRelativePathInput,
  validateSampleLimit,
  validateSessionId
} from '../../../shared/investigation-request-validation'
import type {
  InvestigationExecuteToolResult,
  InvestigationPublicStatus,
  InvestigationToolRequest,
  InvestigationToolResult
} from '../../../shared/investigation-types'
import { getScanSession } from '../../scan/scan-session-store'
import { getProtectedPaths, getPathAccessPolicy } from '../../rules'
import { resolveCandidateByRef } from './candidate-ref'
import { InvestigationError, investigationErrorMessage } from './investigation-errors'
import { buildInvestigationCacheKey, getInvestigationResultCache } from './investigation-cache'
import {
  getInvestigationRuntime,
  notifyInvestigationSessionFingerprint,
  notifyInvestigationSessionStale,
  toPublicStatus
} from './investigation-runtime'
import { normalizeRelativePath, resolveInvestigationPath } from './path-security'
import { listChildrenTool } from './tools/list-children'
import { sampleEntryNamesTool } from './tools/sample-entry-names'
import { summarizeDirectoryTool } from './tools/summarize-directory'
import { measureJsonBytes } from './tool-result-sanitize'

function sessionFingerprint(sessionId: string, createdAt: number, revision: number): string {
  return `${sessionId}:${createdAt}:${revision}`
}

function mapValidationError(error: InvestigationValidationError): never {
  throw new InvestigationError(error.code, error.message)
}

function normalizeExecuteRequest(request: InvestigationToolRequest): InvestigationToolRequest {
  try {
    const sessionId = validateSessionId(request.sessionId)
    const candidateRef = validateCandidateRef(request.candidateRef)
    if (!isInvestigationToolName(request.toolName)) {
      throw new InvestigationError('TOOL_NOT_ALLOWED', '调查工具不可用')
    }
    rejectUnexpectedLimit(request.toolName, request.limit)
    rejectUnexpectedDepth(request.toolName, request.depth)
    const relativePath = validateRelativePathInput(request.relativePath)
    const normalizedRelative = relativePath === undefined ? undefined : normalizeRelativePath(relativePath)
    const limit =
      request.toolName === 'list_children'
        ? validateListLimit(request.limit)
        : request.toolName === 'sample_entry_names'
          ? validateSampleLimit(request.limit)
          : undefined
    const depth = request.toolName === 'summarize_directory' ? validateDepth(request.depth) : undefined
    return normalizeInvestigationToolRequest({
      sessionId,
      candidateRef,
      toolName: request.toolName,
      relativePath: normalizedRelative,
      limit,
      depth
    })
  } catch (error) {
    if (error instanceof InvestigationValidationError) mapValidationError(error)
    throw error
  }
}

export function getInvestigationStatus(sessionId: string): InvestigationPublicStatus | null {
  const session = getScanSession(sessionId)
  if (!session) return null
  const fingerprint = sessionFingerprint(session.sessionId, session.createdAt, session.revision)
  return getInvestigationRuntime().resolveStatus(sessionId, fingerprint)
}

export function startInvestigation(sessionId: string, modelId?: string): InvestigationPublicStatus {
  const session = requireSession(sessionId)
  const fingerprint = sessionFingerprint(session.sessionId, session.createdAt, session.revision)
  const runtime = getInvestigationRuntime()
  try {
    return runtime.start(sessionId, fingerprint, modelId)
  } catch {
    throw new InvestigationError('INVESTIGATION_IN_PROGRESS', '调查正在进行中')
  }
}

export function cancelInvestigation(sessionId: string): InvestigationPublicStatus | null {
  const session = getScanSession(sessionId)
  if (!session) return null
  const runtime = getInvestigationRuntime()
  const status = runtime.cancel(sessionId)
  if (status) return status
  const fingerprint = sessionFingerprint(session.sessionId, session.createdAt, session.revision)
  return runtime.resolveStatus(sessionId, fingerprint)
}

export async function executeInvestigationTool(
  request: InvestigationToolRequest
): Promise<InvestigationExecuteToolResult> {
  const normalized = normalizeExecuteRequest(request)
  const session = requireSession(normalized.sessionId)
  const fingerprint = sessionFingerprint(session.sessionId, session.createdAt, session.revision)
  notifyInvestigationSessionFingerprint(fingerprint)

  const runtime = getInvestigationRuntime()
  const run = runtime.getActiveRun()
  if (!run || run.sessionId !== session.sessionId || run.fingerprint !== fingerprint) {
    throw new InvestigationError('INVESTIGATION_NOT_ACTIVE', '调查未进行')
  }

  const requestId = run.requestId
  if (!runtime.canExecuteTool(requestId)) {
    throw new InvestigationError('INVESTIGATION_NOT_ACTIVE', '调查未进行')
  }

  const resolveAbortReason = () => runtime.getAbortReason(requestId)
  let toolPhaseEntered = false

  try {
    if (run.phase === 'analyzing_result') {
      runtime.transition(requestId, 'resume_analyzing')
    }
    runtime.transition(requestId, 'request_tool')
    runtime.transition(requestId, 'run_tool')
    toolPhaseEntered = true

    run.budget.reserveToolCall()

    const cache = getInvestigationResultCache()
    const relativePath = normalized.relativePath ?? ''
    const cacheKey = buildInvestigationCacheKey({
      fingerprint,
      candidateRef: normalized.candidateRef,
      toolName: normalized.toolName,
      relativePath,
      limit: normalized.limit,
      depth: normalized.depth
    })

    const cached = cache.get(cacheKey)
    if (cached) {
      const bytes = measureJsonBytes(cached)
      run.budget.recordResponseBytes(bytes)
      runtime.transition(requestId, 'tool_done')
      runtime.transition(requestId, 'resume_analyzing')
      toolPhaseEntered = false
      return {
        status: toPublicStatus(run),
        result: cached,
        cached: true
      }
    }

    const candidate = resolveCandidateByRef(session, normalized.candidateRef, fingerprint)
    const resolved = await resolveInvestigationPath({
      candidate,
      relativePath: normalized.relativePath,
      protectedPaths: getProtectedPaths(),
      accessPolicy: getPathAccessPolicy()
    })

    const toolController = new AbortController()
    const toolTimeout = setTimeout(() => {
      if (!runtime.getAbortReason(requestId)) {
        runtime.setAbortReason(requestId, 'tool-timeout')
      }
      toolController.abort()
    }, INVESTIGATION_LIMITS.TOOL_TIMEOUT_MS)

    const onMainAbort = () => toolController.abort()
    if (run.abortController.signal.aborted) {
      toolController.abort()
    } else {
      run.abortController.signal.addEventListener('abort', onMainAbort)
    }

    let result: InvestigationToolResult
    try {
      if (normalized.toolName === 'list_children') {
        result = await listChildrenTool(resolved, normalized.limit, toolController.signal, resolveAbortReason)
      } else if (normalized.toolName === 'summarize_directory') {
        result = await summarizeDirectoryTool(resolved, normalized.depth, toolController.signal, resolveAbortReason)
      } else {
        result = await sampleEntryNamesTool(resolved, normalized.limit, toolController.signal, resolveAbortReason)
      }
    } finally {
      clearTimeout(toolTimeout)
      run.abortController.signal.removeEventListener('abort', onMainAbort)
    }

    if (!runtime.isActiveRequest(requestId, session.sessionId, fingerprint)) {
      throw new InvestigationError('SESSION_STALE', investigationErrorMessage('SESSION_STALE'))
    }

    const bytes = measureJsonBytes(result)
    run.budget.recordResponseBytes(bytes)
    cache.set(cacheKey, result)

    runtime.transition(requestId, 'tool_done')
    runtime.transition(requestId, 'resume_analyzing')
    toolPhaseEntered = false

    return {
      status: toPublicStatus(run),
      result,
      cached: false
    }
  } catch (error) {
    try {
      const reason = runtime.getAbortReason(requestId)
      if (reason === 'tool-timeout' || reason === 'investigation-timeout') {
        runtime.setError(requestId, 'TIMEOUT', investigationErrorMessage('TIMEOUT'))
        if (reason === 'tool-timeout') {
          runtime.rollbackToolPhase(requestId)
        }
        throw new InvestigationError('TIMEOUT', investigationErrorMessage('TIMEOUT'))
      }
      if (reason === 'user-cancel') {
        throw new InvestigationError('CANCELLED', investigationErrorMessage('CANCELLED'))
      }
      if (reason === 'session-stale') {
        throw new InvestigationError('SESSION_STALE', investigationErrorMessage('SESSION_STALE'))
      }
      if (!runtime.isActiveRequest(requestId, session.sessionId, fingerprint)) {
        throw new InvestigationError('SESSION_STALE', investigationErrorMessage('SESSION_STALE'))
      }
      if (run.abortController.signal.aborted) {
        throw new InvestigationError('CANCELLED', investigationErrorMessage('CANCELLED'))
      }
      if (error instanceof InvestigationError && error.code === 'TOOL_LIMIT_EXCEEDED') {
        toolPhaseEntered = false
        runtime.finalizeBudgetExceeded(requestId)
        throw error
      }
      if (error instanceof InvestigationError) {
        runtime.setError(requestId, error.code, error.message)
        runtime.complete(requestId, 'failed', { code: error.code, message: error.message })
        throw error
      }
      if (error instanceof Error && error.message === 'RESPONSE_TOO_LARGE') {
        const invError = new InvestigationError('RESPONSE_TOO_LARGE', investigationErrorMessage('RESPONSE_TOO_LARGE'))
        runtime.complete(requestId, 'failed', { code: invError.code, message: invError.message })
        throw invError
      }
      if (error instanceof Error && error.message === 'INVESTIGATION_INVALID_TRANSITION') {
        runtime.rollbackToolPhase(requestId)
        throw new InvestigationError('INVESTIGATION_NOT_ACTIVE', '调查未进行')
      }
      const invError = new InvestigationError('IO_ERROR', investigationErrorMessage('IO_ERROR'))
      runtime.complete(requestId, 'failed', { code: invError.code, message: invError.message })
      throw invError
    } finally {
      if (toolPhaseEntered) {
        runtime.rollbackToolPhase(requestId)
      }
      runtime.consumeAbortReason(requestId)
    }
  }
}

export function advanceInvestigationRound(sessionId: string): InvestigationPublicStatus {
  const session = requireSession(sessionId)
  const fingerprint = sessionFingerprint(session.sessionId, session.createdAt, session.revision)
  const runtime = getInvestigationRuntime()
  const active = runtime.getActiveRun()
  if (!active || active.sessionId !== sessionId || active.fingerprint !== fingerprint) {
    throw new InvestigationError('INVESTIGATION_NOT_ACTIVE', '调查未进行')
  }
  try {
    return runtime.advanceRound(active.requestId, sessionId, fingerprint)
  } catch (error) {
    if (error instanceof Error && error.message === 'INVESTIGATION_INVALID_TRANSITION') {
      throw new InvestigationError('INVESTIGATION_NOT_ACTIVE', '调查未进行')
    }
    if (error instanceof Error && error.message === 'SESSION_STALE') {
      throw new InvestigationError('SESSION_STALE', investigationErrorMessage('SESSION_STALE'))
    }
    throw error
  }
}

export function reuseInvestigationDataForModelSwitch(sessionId: string, modelId: string): InvestigationPublicStatus {
  const session = requireSession(sessionId)
  const fingerprint = sessionFingerprint(session.sessionId, session.createdAt, session.revision)
  const runtime = getInvestigationRuntime()
  const active = runtime.getActiveRun()
  if (!active || active.sessionId !== sessionId || active.fingerprint !== fingerprint) {
    throw new InvestigationError('INVESTIGATION_NOT_ACTIVE', '调查未进行')
  }
  runtime.setConclusionModel(active.requestId, modelId)
  return toPublicStatus(active)
}

export function completeInvestigation(
  sessionId: string,
  phase: 'completed' | 'uncertain' = 'completed'
): InvestigationPublicStatus {
  const session = requireSession(sessionId)
  const fingerprint = sessionFingerprint(session.sessionId, session.createdAt, session.revision)
  const runtime = getInvestigationRuntime()
  const active = runtime.getActiveRun()
  if (!active || active.sessionId !== sessionId || active.fingerprint !== fingerprint) {
    throw new InvestigationError('INVESTIGATION_NOT_ACTIVE', '调查未进行')
  }
  return runtime.complete(active.requestId, phase)
}

function requireSession(sessionId: string) {
  const session = getScanSession(sessionId)
  if (!session) {
    throw new InvestigationError('SESSION_STALE', investigationErrorMessage('SESSION_STALE'))
  }
  const runtime = getInvestigationRuntime()
  const fingerprint = sessionFingerprint(session.sessionId, session.createdAt, session.revision)
  const active = runtime.getActiveRun()
  if (active && active.fingerprint !== fingerprint) {
    notifyInvestigationSessionStale()
    throw new InvestigationError('SESSION_STALE', investigationErrorMessage('SESSION_STALE'))
  }
  return session
}

export function onScanSessionRevisionChanged(): void {
  notifyInvestigationSessionStale()
}

export function onNewScanSession(fingerprint: string): void {
  notifyInvestigationSessionFingerprint(fingerprint)
  getInvestigationResultCache().clearAll()
  const sessionId = fingerprint.split(':')[0]
  if (sessionId) {
    getInvestigationRuntime().clearHistoryExcept(sessionId)
  }
}

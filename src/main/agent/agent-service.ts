import { randomUUID } from 'crypto'
import { buildAgentInvestigationCandidates } from '../../shared/agent-candidate-prep'
import {
  buildCandidateRefIndex,
  buildSessionFingerprint
} from '../../shared/candidate-ref-index'
import type { AgentAnalyzeRequest, AgentAnalyzeResult, AgentAnalysisPublic } from '../../shared/agent-types'
import type { ScanItem } from '../../shared/types'
import { getScanSession, updateScanSessionCandidates } from '../scan/scan-session-store'
import { getProtectedPaths, getPathAccessPolicy } from '../rules'
import { ProviderError } from '../provider/provider-errors'
import { getProviderConfig, requireRunnableConfig } from '../provider/provider-service'
import { applyAgentRecommendations } from './agent-candidate-mapper'
import { AgentError } from './agent-errors'
import { getAgentAnalysisState } from './agent-analysis-state'
import {
  cancelInvestigation,
  onNewScanSession,
  onScanSessionRevisionChanged
} from './investigation/investigation-service'
import { getInvestigationRuntime } from './investigation/investigation-runtime'
import { getActiveScanSessionInfo } from '../scan/scan-session-store'
import { filterRecommendationsByRefs } from './agent-response'
import { clearCandidateRefMaps } from './investigation/candidate-ref'
import {
  createWebContentsTimelineSink,
  setInvestigationTimelineSink
} from './investigation/investigation-timeline-bus'
import { runInvestigationOrchestration } from './investigation/investigation-orchestrator'
import type { WebContents } from 'electron'

export function notifyNewScanSession(sessionId: string): void {
  getAgentAnalysisState().markNewScanSession(sessionId)
  const info = getActiveScanSessionInfo()
  if (info?.sessionId === sessionId) {
    onNewScanSession(info.fingerprint)
  }
  clearCandidateRefMaps()
}

export function markAgentScanStarting(): void {
  getAgentAnalysisState().markScanStarting()
  getInvestigationRuntime().markStale()
}

export function cancelAgentAnalysis(): void {
  getAgentAnalysisState().cancelActiveRun('cancelled')
  getInvestigationRuntime().cancelActive()
  const info = getActiveScanSessionInfo()
  if (info) {
    try {
      cancelInvestigation(info.sessionId)
    } catch {
      // ignore if investigation not active
    }
  }
}

function buildSkippedResult(sessionId: string): AgentAnalyzeResult {
  const analysis: AgentAnalysisPublic = {
    sessionId,
    status: 'skipped_no_provider',
    analyzedCount: 0,
    omittedCount: 0,
    appliedCount: 0,
    skippedInvalidCount: 0
  }
  const session = getScanSession(sessionId)
  return { analysis, items: session ? [...session.candidates.values()] : [] }
}

export interface RunAgentAnalysisOptions {
  webContents?: WebContents
  isTrustedSender?: () => boolean
}

export async function runAgentAnalysis(
  request: AgentAnalyzeRequest,
  options: RunAgentAnalysisOptions = {}
): Promise<AgentAnalyzeResult> {
  const sessionId = request.sessionId?.trim()
  if (!sessionId) {
    throw new AgentError('INVALID_INPUT', '无效的扫描会话')
  }

  const session = getScanSession(sessionId)
  if (!session) {
    throw new AgentError('SESSION_NOT_FOUND', '扫描会话已过期或无效')
  }

  const state = getAgentAnalysisState()
  if (!state.isLatestSession(sessionId)) {
    throw new AgentError('SESSION_STALE', '扫描会话已过期')
  }

  if (!request.retry && state.hasCompleted(sessionId)) {
    throw new AgentError('ANALYSIS_ALREADY_DONE', '本次扫描已完成智能分析')
  }

  if (state.getActiveRun()?.sessionId === sessionId && !request.retry) {
    throw new AgentError('ANALYSIS_IN_PROGRESS', '智能分析正在进行中')
  }

  const publicConfig = getProviderConfig()
  if (!publicConfig?.hasKey) {
    return buildSkippedResult(sessionId)
  }

  const items = [...session.candidates.values()]
  if (items.length === 0) {
    const analysis: AgentAnalysisPublic = {
      sessionId,
      status: 'completed',
      headline: '未发现可分析项',
      overview: '本次扫描没有候选项可供分析。',
      analyzedCount: 0,
      omittedCount: 0,
      appliedCount: 0,
      skippedInvalidCount: 0
    }
    return { analysis, items }
  }

  const run = state.beginRun(sessionId)
  const requestId = run.requestId
  const generation = randomUUID()
  const fingerprint = buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)
  const refIndex = buildCandidateRefIndex(items, fingerprint, session.revision)
  const pathPolicy = getPathAccessPolicy()
  const investigationCandidates = buildAgentInvestigationCandidates(items, {
    pathAccessPolicy: pathPolicy,
    refIndex: { idToRef: refIndex.idToRef, fingerprint, revision: session.revision }
  })

  const timelineSink =
    options.webContents && options.isTrustedSender
      ? createWebContentsTimelineSink(options.webContents, options.isTrustedSender)
      : null
  setInvestigationTimelineSink(timelineSink)

  try {
    const { config, apiKey, profileId } = requireRunnableConfig()
    const profile = { profileId, config, apiKey }

    const orchestration = await runInvestigationOrchestration({
      session,
      refIndex,
      investigationCandidates,
      profile,
      requestId,
      generation,
      signal: run.abortController.signal,
      isActive: () => state.isActiveRequest(requestId, sessionId),
      pathAccessPolicy: pathPolicy,
      fetchFn: agentFetchOptions.fetchFn
    })

    if (!state.isActiveRequest(requestId, sessionId)) {
      throw new AgentError('SESSION_STALE', '扫描会话已过期')
    }

    const validRefs = new Set([
      ...orchestration.eligibleRefs,
      ...orchestration.investigatedRefs
    ])
    const filtered = filterRecommendationsByRefs(orchestration.parsed.recommendations, validRefs)
    const { items: updatedItems, appliedCount } = applyAgentRecommendations(
      items,
      filtered.accepted,
      refIndex.refToId,
      getProtectedPaths()
    )

    if (!state.isActiveRequest(requestId, sessionId)) {
      throw new AgentError('SESSION_STALE', '扫描会话已过期')
    }

    updateScanSessionCandidates(sessionId, updatedItems)
    onScanSessionRevisionChanged()
    state.markCompleted(sessionId)

    const analysis: AgentAnalysisPublic = {
      sessionId,
      status: orchestration.uncertain ? 'completed' : 'completed',
      requestId,
      headline: orchestration.parsed.summary.headline,
      overview: orchestration.parsed.summary.overview,
      analyzedCount: orchestration.eligibleRefs.size,
      omittedCount: Math.max(0, items.length - orchestration.eligibleRefs.size),
      appliedCount,
      skippedInvalidCount:
        orchestration.parsed.skippedInvalidCount + filtered.skippedInvalidCount
    }

    return {
      analysis,
      items: updatedItems,
      investigation: orchestration.investigation
    }
  } catch (error) {
    if (!state.isLatestSession(sessionId)) {
      throw new AgentError('SESSION_STALE', '扫描会话已过期')
    }
    if (run.abortController.signal.aborted) {
      throw new AgentError('CANCELLED', '智能分析已取消')
    }
    if (error instanceof AgentError) throw error
    if (error instanceof ProviderError) {
      if (error.code === 'CANCELLED') {
        throw new AgentError('CANCELLED', '智能分析已取消')
      }
      if (error.code === 'TIMEOUT') {
        throw new AgentError('TIMEOUT', '连接超时')
      }
      if (error.code === 'RESPONSE_TOO_LARGE') {
        throw new AgentError('RESPONSE_TOO_LARGE', '模型响应过大')
      }
      if (error.code === 'INVALID_RESPONSE') {
        throw new AgentError('RESPONSE_INVALID', '模型返回了无效建议')
      }
      if (error.code === 'AUTH_FAILED') {
        throw new AgentError('AUTH_FAILED', '模型鉴权失败')
      }
      if (error.code === 'MODEL_NOT_FOUND') {
        throw new AgentError('MODEL_NOT_FOUND', '模型不可用')
      }
      if (error.code === 'NETWORK_ERROR') {
        throw new AgentError('NETWORK_ERROR', '模型服务暂时不可用')
      }
      throw new AgentError(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : '智能分析失败'
      )
    }
    if (error instanceof Error && error.message === 'RESPONSE_INVALID') {
      throw new AgentError('RESPONSE_INVALID', '模型返回了无效建议')
    }
    if (error instanceof Error && error.message === 'PROMPT_TOO_LARGE') {
      throw new AgentError('PROMPT_TOO_LARGE', '扫描摘要过大，无法发起分析')
    }
    throw new AgentError('INTERNAL_ERROR', '智能分析失败')
  } finally {
    setInvestigationTimelineSink(null)
    state.endRun(requestId)
  }
}

export const agentFetchOptions: { fetchFn?: typeof fetch } = {}

export function setAgentFetchForTests(fetchFn?: typeof fetch): void {
  agentFetchOptions.fetchFn = fetchFn
}

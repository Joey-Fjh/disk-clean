import { AGENT_LIMITS } from '../../../shared/agent-limits'
import type { AgentInvestigationCandidate } from '../../../shared/agent-candidate-prep'
import type { CandidateRefIndex } from '../../../shared/candidate-ref-index'
import { INVESTIGATION_LIMITS } from '../../../shared/investigation-limits'
import { isInvestigationTerminal } from '../../../shared/investigation-state-machine'
import type { InvestigationSummary } from '../../../shared/investigation-timeline-types'
import type { InvestigationToolResultMessage } from '../../../shared/investigation-turn-types'
import {
  DEFAULT_PATH_ACCESS_POLICY,
  isPathReadableForInvestigation,
  type PathAccessPolicy
} from '../../../shared/path-access-policy'
import type { ProviderConfigPublic } from '../../../shared/provider-types'
import { chatCompletion } from '../../provider/provider-client'
import { ProviderError } from '../../provider/provider-errors'
import type { ScanSession } from '../../scan/scan-session-store'
import { getPathAccessPolicy } from '../../rules'
import { buildAgentMessages, measureConversationBytes } from '../agent-prompt'
import type { ParseAgentResponseResult } from '../agent-response'
import { AgentError } from '../agent-errors'
import { registerCandidateRefMap, releaseCandidateRefMap, resolveCandidateByRef } from './candidate-ref'
import { InvestigationError } from './investigation-errors'
import {
  advanceInvestigationRound,
  cancelInvestigation,
  completeInvestigation,
  executeInvestigationTool,
  getInvestigationStatus,
  startInvestigation
} from './investigation-service'
import { parseModelTurn, parseNativeToolCalls } from './investigation-turn-parser'
import { InvestigationTimelineCollector } from './investigation-timeline-bus'
import type { InvestigationToolResult } from '../../../shared/investigation-types'
import { getInvestigationRuntime } from './investigation-runtime'

export interface ProfileSnapshot {
  profileId: string
  config: ProviderConfigPublic
  apiKey: string
}

export interface InvestigationOrchestratorInput {
  session: ScanSession
  refIndex: CandidateRefIndex
  investigationCandidates: AgentInvestigationCandidate[]
  profile: ProfileSnapshot
  requestId: string
  generation: string
  signal: AbortSignal
  isActive: () => boolean
  pathAccessPolicy?: PathAccessPolicy
  fetchFn?: typeof fetch
}

export interface InvestigationOrchestratorResult {
  parsed: ParseAgentResponseResult
  investigation: InvestigationSummary
  uncertain: boolean
  eligibleRefs: Set<string>
  investigatedRefs: Set<string>
}

const LIFECYCLE_INVESTIGATION_CODES = new Set([
  'CANCELLED',
  'SESSION_STALE',
  'TIMEOUT',
  'TOOL_LIMIT_EXCEEDED',
  'INVESTIGATION_NOT_ACTIVE'
])

function mapProviderError(error: ProviderError): AgentError {
  if (error.code === 'CANCELLED') return new AgentError('CANCELLED', '智能分析已取消')
  if (error.code === 'TIMEOUT') return new AgentError('TIMEOUT', '连接超时')
  if (error.code === 'INVALID_RESPONSE') {
    return new AgentError('RESPONSE_INVALID', '模型返回了无效建议')
  }
  if (error.code === 'RESPONSE_TOO_LARGE') {
    return new AgentError('RESPONSE_TOO_LARGE', '模型响应过大')
  }
  if (error.code === 'AUTH_FAILED') return new AgentError('AUTH_FAILED', '模型鉴权失败')
  if (error.code === 'MODEL_NOT_FOUND') return new AgentError('MODEL_NOT_FOUND', '模型不可用')
  if (error.code === 'NETWORK_ERROR') {
    return new AgentError('NETWORK_ERROR', '模型服务暂时不可用')
  }
  return new AgentError('INTERNAL_ERROR', error.message)
}

function mapInvestigationLifecycleError(error: InvestigationError): AgentError {
  if (error.code === 'CANCELLED') return new AgentError('CANCELLED', error.message)
  if (error.code === 'SESSION_STALE') return new AgentError('SESSION_STALE', error.message)
  if (error.code === 'TIMEOUT') return new AgentError('TIMEOUT', error.message)
  if (error.code === 'TOOL_LIMIT_EXCEEDED') {
    return new AgentError('TOOL_LIMIT_EXCEEDED', error.message)
  }
  if (error.code === 'INVESTIGATION_NOT_ACTIVE') {
    return new AgentError('INVESTIGATION_NOT_ACTIVE', error.message)
  }
  return new AgentError('INTERNAL_ERROR', error.message)
}

function rethrowIfLifecycleError(error: unknown): void {
  if (error instanceof InvestigationError && LIFECYCLE_INVESTIGATION_CODES.has(error.code)) {
    throw mapInvestigationLifecycleError(error)
  }
}

function summarizeToolResult(result: InvestigationToolResult): {
  summary: string
  itemCount?: number
  byteCount?: number
  truncated?: boolean
} {
  if (result.tool === 'list_children') {
    return {
      summary: `${result.entries.length} 项`,
      itemCount: result.entries.length,
      truncated: result.truncated
    }
  }
  if (result.tool === 'summarize_directory') {
    const s = result.summary
    return {
      summary: `${s.fileCount} 个文件、${s.directoryCount} 个子目录`,
      itemCount: s.fileCount + s.directoryCount,
      byteCount: s.totalBytes,
      truncated: s.truncated
    }
  }
  return {
    summary: `${result.names.length} 个名称样本`,
    itemCount: result.names.length,
    truncated: result.truncated
  }
}

function buildUncertainResult(headline: string, overview: string): ParseAgentResponseResult {
  return {
    summary: { headline, overview },
    recommendations: [],
    skippedInvalidCount: 0
  }
}

function finalizeInvestigationIfActive(
  sessionId: string,
  phase: 'completed' | 'uncertain'
): void {
  const runtime = getInvestigationRuntime()
  if (!runtime.hasActiveRun(sessionId)) return
  completeInvestigation(sessionId, phase)
}

async function executeToolCall(
  sessionId: string,
  call: { candidateRef: string; tool: string; relativePath?: string; depth?: number; limit?: number },
  policy: PathAccessPolicy,
  session: ScanSession,
  fingerprint: string,
  allowedRefs: Set<string>
): Promise<InvestigationToolResultMessage> {
  if (!allowedRefs.has(call.candidateRef)) {
    return {
      candidateRef: call.candidateRef,
      tool: call.tool as InvestigationToolResultMessage['tool'],
      ok: false,
      errorCode: 'CANDIDATE_NOT_FOUND',
      errorMessage: '候选引用不在本轮调查范围内'
    }
  }

  try {
    const target = resolveCandidateByRef(session, call.candidateRef, fingerprint)
    if (!isPathReadableForInvestigation(target.path, policy)) {
      return {
        candidateRef: call.candidateRef,
        tool: call.tool as InvestigationToolResultMessage['tool'],
        ok: false,
        errorCode: 'PROTECTED_PATH',
        errorMessage: '该位置不允许只读调查'
      }
    }
    const result = await executeInvestigationTool({
      sessionId,
      candidateRef: call.candidateRef,
      toolName: call.tool as InvestigationToolResultMessage['tool'],
      relativePath: call.relativePath,
      depth: call.depth,
      limit: call.limit
    })
    const summary = summarizeToolResult(result.result!)
    return {
      candidateRef: call.candidateRef,
      tool: call.tool as InvestigationToolResultMessage['tool'],
      ok: true,
      cached: result.cached,
      truncated: summary.truncated,
      summary: summary.summary,
      data: result.result
    }
  } catch (error) {
    rethrowIfLifecycleError(error)
    if (error instanceof InvestigationError) {
      return {
        candidateRef: call.candidateRef,
        tool: call.tool as InvestigationToolResultMessage['tool'],
        ok: false,
        errorCode: error.code,
        errorMessage: error.message
      }
    }
    return {
      candidateRef: call.candidateRef,
      tool: call.tool as InvestigationToolResultMessage['tool'],
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: '调查工具执行失败'
    }
  }
}

export async function runInvestigationOrchestration(
  input: InvestigationOrchestratorInput
): Promise<InvestigationOrchestratorResult> {
  const {
    session,
    refIndex,
    investigationCandidates,
    profile,
    generation,
    signal,
    isActive,
    fetchFn
  } = input
  const policy = input.pathAccessPolicy ?? getPathAccessPolicy() ?? DEFAULT_PATH_ACCESS_POLICY
  const sessionId = session.sessionId
  const fingerprint = refIndex.fingerprint
  const timeline = new InvestigationTimelineCollector(sessionId, generation)
  let roundCount = 0
  let toolCallCount = 0
  let cacheHitCount = 0
  let uncertain = false
  const investigatedRefs = new Set<string>()
  let eligibleRefs = new Set<string>()

  registerCandidateRefMap(fingerprint, refIndex.refToId)

  try {
  startInvestigation(sessionId, profile.config.model)

  timeline.emit(
    'investigation_started',
    `正在分析 ${investigationCandidates.length} 个高占用位置`
  )

  const userHome = process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users'
  const userName = userHome.split(/[\\/]/).pop() ?? 'user'
  const { messages, build } = buildAgentMessages(refIndex.orderedItems, {
    userHome,
    userName,
    refIndex: { refToId: refIndex.refToId, idToRef: refIndex.idToRef },
    investigationCandidates
  })
  eligibleRefs = new Set(build.refToId.keys())
  const allowedInvestigationRefs = new Set(
    investigationCandidates
      .map((candidate) => candidate.candidateRef)
      .filter((candidateRef) => eligibleRefs.has(candidateRef))
  )

  const conversation: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    ...messages
  ]

  let parsed: ParseAgentResponseResult | null = null
  let investigationFinalized = false

    while (roundCount < INVESTIGATION_LIMITS.MAX_ROUNDS) {
      if (!isActive()) {
        throw new AgentError('SESSION_STALE', '扫描会话已过期')
      }
      if (signal.aborted) {
        throw new AgentError('CANCELLED', '智能分析已取消')
      }

      const conversationBytes = measureConversationBytes(conversation)
      if (conversationBytes > AGENT_LIMITS.MAX_CONVERSATION_BYTES) {
        uncertain = true
        parsed = buildUncertainResult(
          '部分项目无法确定',
          '对话上下文过大，已保留本地规则建议。'
        )
        timeline.emit('uncertain', '对话上下文过大')
        break
      }

      timeline.emit('model_analyzing', '正在生成清理建议')
      roundCount += 1

      let completion
      try {
        completion = await chatCompletion({
          baseUrl: profile.config.baseUrl,
          apiKey: profile.apiKey,
          model: profile.config.model,
          messages: conversation,
          maxTokens: AGENT_LIMITS.ANALYSIS_MAX_TOKENS,
          temperature: 0.2,
          timeoutMs: AGENT_LIMITS.ANALYSIS_TIMEOUT_MS,
          signal,
          fetchFn
        })
      } catch (error) {
        if (signal.aborted) throw new AgentError('CANCELLED', '智能分析已取消')
        if (error instanceof ProviderError) throw mapProviderError(error)
        throw error
      }

      if (!isActive()) {
        throw new AgentError('SESSION_STALE', '扫描会话已过期')
      }

      const nativeCalls = completion.toolCalls as
        | Array<{ function?: { name?: string; arguments?: string } }>
        | undefined
      let turn
      try {
        turn = nativeCalls?.length
          ? parseNativeToolCalls(nativeCalls, completion.content)
          : parseModelTurn(completion.content)
      } catch {
        if (toolCallCount === 0 && roundCount === 1) {
          throw new AgentError('RESPONSE_INVALID', '模型返回了无效建议')
        }
        uncertain = true
        parsed = buildUncertainResult('部分项目无法确定', '模型返回了无效响应，已保留本地规则建议。')
        timeline.emit('uncertain', '部分项目无法确定')
        break
      }

      if (turn.kind === 'legacy-final' || turn.kind === 'final') {
        parsed = turn.parsed
        break
      }

      for (const call of turn.turn.calls) {
        if (!allowedInvestigationRefs.has(call.candidateRef)) {
          if (toolCallCount === 0 && roundCount === 1) {
            throw new AgentError('RESPONSE_INVALID', '模型返回了无效建议')
          }
          uncertain = true
          parsed = buildUncertainResult('部分项目无法确定', '模型请求了不允许调查的候选引用。')
          timeline.emit('uncertain', '部分项目无法确定')
          break
        }
      }
      if (parsed) break

      conversation.push({ role: 'assistant', content: JSON.stringify(turn.turn) })

      const toolMessages: InvestigationToolResultMessage[] = []
      for (const call of turn.turn.calls) {
        if (!isActive()) throw new AgentError('SESSION_STALE', '扫描会话已过期')
        if (signal.aborted) throw new AgentError('CANCELLED', '智能分析已取消')

        const toolLabel =
          call.tool === 'summarize_directory'
            ? '目录构成'
            : call.tool === 'list_children'
              ? '子项列表'
              : '名称样本'
        timeline.emit('tool_requested', `正在查看 ${call.candidateRef} 的${toolLabel}`, {
          candidateRef: call.candidateRef,
          tool: call.tool
        })

        const toolResult = await executeToolCall(
          sessionId,
          call,
          policy,
          session,
          fingerprint,
          allowedInvestigationRefs
        )
        toolCallCount += 1
        if (toolResult.ok) {
          investigatedRefs.add(call.candidateRef)
        }
        if (toolResult.cached) cacheHitCount += 1

        const resultSummary =
          toolResult.ok && toolResult.data
            ? summarizeToolResult(toolResult.data as InvestigationToolResult)
            : null

        timeline.emit(
          'tool_completed',
          toolResult.ok
            ? `已取得${toolLabel}：${toolResult.summary ?? '完成'}`
            : `调查受限：${toolResult.errorMessage ?? '无法访问'}`,
          {
            candidateRef: call.candidateRef,
            tool: call.tool,
            itemCount: resultSummary?.itemCount,
            byteCount: resultSummary?.byteCount,
            truncated: toolResult.truncated,
            cached: toolResult.cached
          }
        )
        toolMessages.push(toolResult)
      }

      const roundStatus = advanceInvestigationRound(sessionId)
      if (roundStatus.phase === 'uncertain' || isInvestigationTerminal(roundStatus.phase)) {
        uncertain = true
        parsed = buildUncertainResult(
          '部分项目无法确定',
          roundStatus.lastErrorMessage ?? '调查预算已用尽，已保留本地规则建议。'
        )
        timeline.emit('uncertain', '调查预算已用尽')
        investigationFinalized = true
        break
      }

      conversation.push({
        role: 'user',
        content: JSON.stringify({
          schemaVersion: 1,
          untrustedDiskData: true,
          toolResults: toolMessages
        })
      })
    }

    if (!parsed) {
      uncertain = true
      parsed = buildUncertainResult('部分项目无法确定', '调查轮次已达上限，已保留本地规则建议。')
      timeline.emit('uncertain', '部分项目无法确定')
      finalizeInvestigationIfActive(sessionId, 'uncertain')
      investigationFinalized = true
    } else if (!investigationFinalized) {
      finalizeInvestigationIfActive(sessionId, uncertain ? 'uncertain' : 'completed')
      investigationFinalized = true
      timeline.emit(uncertain ? 'uncertain' : 'completed', uncertain ? '部分项目无法确定' : '调查完成')
    }

    return {
      parsed,
      uncertain,
      eligibleRefs,
      investigatedRefs,
      investigation: {
        generation,
        roundCount,
        toolCallCount,
        cacheHitCount,
        uncertain,
        timeline: timeline.snapshot()
      }
    }
  } catch (error) {
    if (error instanceof AgentError && error.code === 'TOOL_LIMIT_EXCEEDED') {
      uncertain = true
      timeline.emit('uncertain', '调查预算已用尽')
      return {
        parsed: buildUncertainResult(
          '部分项目无法确定',
          '调查预算已用尽，已保留本地规则建议。'
        ),
        uncertain: true,
        eligibleRefs,
        investigatedRefs,
        investigation: {
          generation,
          roundCount,
          toolCallCount,
          cacheHitCount,
          uncertain: true,
          timeline: timeline.snapshot()
        }
      }
    }
    const status = getInvestigationStatus(sessionId)
    if (status && !isInvestigationTerminal(status.phase)) {
      try {
        cancelInvestigation(sessionId)
      } catch {
        // ignore cleanup errors
      }
    }
    throw error
  } finally {
    releaseCandidateRefMap(fingerprint)
  }
}

import { homedir, userInfo } from 'os'
import { RULE_DRAFT_LIMITS } from '../../shared/rule-draft-limits'
import type { AgentGenerateRuleDraftRequest, AgentGenerateRuleDraftResult } from '../../shared/rule-layer-types'
import type { ScanItem } from '../../shared/types'
import { getScanSession } from '../scan/scan-session-store'
import { ProviderError } from '../provider/provider-errors'
import { chatCompletion } from '../provider/provider-client'
import { getProviderConfig, requireRunnableConfig } from '../provider/provider-service'
import { AgentError } from '../agent/agent-errors'
import { buildAgentPromptPayload } from '../agent/agent-prompt'
import { extractUserName } from '../agent/path-sanitize'
import { createRuleDraftRecord } from './rule-draft-store'
import { sessionFingerprint } from './rule-draft-preview'
import { buildRuleDraftMessages, type RuleDraftPromptBuild } from './rule-draft-agent-prompt'
import { parseRuleDraftModelResponse } from './rule-draft-agent-response'
import { getRuleDraftAgentState } from './rule-draft-agent-state'

export async function runAgentGenerateRuleDraft(
  request: AgentGenerateRuleDraftRequest
): Promise<AgentGenerateRuleDraftResult> {
  const sessionId = request.sessionId?.trim()
  if (!sessionId) throw new AgentError('INVALID_INPUT', '无效的扫描会话')

  const candidateIds = Array.isArray(request.candidateIds) ? request.candidateIds : []
  if (candidateIds.length === 0) throw new AgentError('INVALID_INPUT', '请至少选择一个候选项')
  if (candidateIds.length > RULE_DRAFT_LIMITS.MAX_CANDIDATES_PER_REQUEST) {
    throw new AgentError('INVALID_INPUT', '候选项数量过多')
  }

  const session = getScanSession(sessionId)
  if (!session) throw new AgentError('SESSION_NOT_FOUND', '扫描会话已过期或无效')

  const state = getRuleDraftAgentState()
  if (!state.isLatestSession(sessionId)) {
    throw new AgentError('SESSION_STALE', '扫描会话已过期')
  }
  if (state.getActiveRun()?.sessionId === sessionId) {
    throw new AgentError('DRAFT_IN_PROGRESS', '规则草稿生成正在进行中')
  }

  const items: ScanItem[] = []
  for (const id of candidateIds) {
    const item = session.candidates.get(id)
    if (!item) throw new AgentError('INVALID_INPUT', '候选项不属于当前扫描会话')
    items.push(item)
  }

  const publicConfig = getProviderConfig()
  if (!publicConfig?.hasKey) {
    throw new AgentError('PROVIDER_NOT_CONFIGURED', '未配置模型，可导出规则编写包')
  }

  const run = state.beginRun(sessionId)
  const requestId = run.requestId

  try {
    const { config, apiKey } = requireRunnableConfig()
    const userHome = homedir()
    const userName = extractUserName(userHome) ?? userInfo().username
    const promptBuild: RuleDraftPromptBuild = buildRuleDraftMessages(items, { userHome, userName })

    if (promptBuild.requestBytes > RULE_DRAFT_LIMITS.MAX_REQUEST_BYTES) {
      throw new AgentError('PROMPT_TOO_LARGE', '扫描摘要过大，无法生成规则草稿')
    }

    const completion = await chatCompletion({
      baseUrl: config.baseUrl,
      apiKey,
      model: config.model,
      messages: promptBuild.messages,
      maxTokens: RULE_DRAFT_LIMITS.DRAFT_MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: RULE_DRAFT_LIMITS.ANALYSIS_TIMEOUT_MS,
      signal: run.abortController.signal
    })

    if (!state.isActiveRequest(requestId, sessionId)) {
      throw new AgentError('SESSION_STALE', '扫描会话已过期')
    }

    const draft = parseRuleDraftModelResponse(completion.content)
    const record = createRuleDraftRecord(
      {
        ...draft,
        source: 'agent-generated',
        generatedFromSessionId: sessionId,
        generatedFromCandidateIds: candidateIds,
        createdAt: new Date().toISOString()
      },
      'agent-generated',
      {
        sessionId,
        sessionFingerprint: sessionFingerprint(session),
        candidateIds,
        status: 'validated'
      }
    )

    state.markCompleted(sessionId)
    return { draftId: record.id, draft: record.draft, status: record.status }
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.code === 'TIMEOUT') throw new AgentError('TIMEOUT', '规则草稿生成超时')
      if (error.code === 'CANCELLED') throw new AgentError('CANCELLED', '规则草稿生成已取消')
      throw new AgentError('INTERNAL_ERROR', '模型请求失败')
    }
    if (error instanceof AgentError) throw error
    if (error instanceof Error && error.message === 'RESPONSE_INVALID') {
      throw new AgentError('RESPONSE_INVALID', '模型返回格式无效')
    }
    throw new AgentError('INTERNAL_ERROR', '规则草稿生成失败')
  } finally {
    state.endRun(requestId)
  }
}

export function cancelRuleDraftGeneration(): void {
  getRuleDraftAgentState().cancelActiveRun('cancelled')
}

export function notifyRuleDraftNewScanSession(sessionId: string): void {
  getRuleDraftAgentState().markNewScanSession(sessionId)
}

export function markRuleDraftScanStarting(): void {
  getRuleDraftAgentState().markScanStarting()
}

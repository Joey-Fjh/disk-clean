import type { AgentAnalysisPublic } from '../shared/agent-types'
import type { ScanItem } from '../shared/types'
import {
  appendInvestigationTimelineEvent,
  beginInvestigationTimeline,
  getActiveTimelineGeneration,
  mergeInvestigationTimelineFromResult,
  resetInvestigationTimeline,
  wireInvestigationTimelineSubscription
} from './agent-investigation-timeline'

export type AgentUiPhase = 'idle' | 'running' | 'completed' | 'skipped' | 'failed'

let currentAnalysis: AgentAnalysisPublic | null = null
let analysisGeneration = 0
let activeRequest: { generation: number; sessionId: string; promise: Promise<void> } | null = null
let autoAnalyzeSessionId: string | null = null

const bannerEl = () => document.getElementById('agent-analysis-banner') as HTMLElement | null
const headlineEl = () => document.getElementById('agent-analysis-headline') as HTMLElement | null
const overviewEl = () => document.getElementById('agent-analysis-overview') as HTMLElement | null
const metaEl = () => document.getElementById('agent-analysis-meta') as HTMLElement | null
const retryBtn = () => document.getElementById('agent-analysis-retry') as HTMLButtonElement | null
const stopBtn = () => document.getElementById('agent-analysis-stop') as HTMLButtonElement | null
const settingsLink = () => document.getElementById('agent-analysis-settings-link') as HTMLButtonElement | null
const panelClean = () => document.getElementById('panel-clean') as HTMLElement | null

export function getCurrentAgentAnalysis(): AgentAnalysisPublic | null {
  return currentAnalysis
}

export function isAgentAnalysisRunning(): boolean {
  return currentAnalysis?.status === 'running'
}

export function shouldAutoAnalyzeAfterScan(cancelled: boolean): boolean {
  return !cancelled
}

function isStaleGeneration(generation: number): boolean {
  return generation !== analysisGeneration
}

function preservePanelScroll(callback: () => void): void {
  const panel = panelClean()
  const scrollTop = panel?.scrollTop ?? 0
  callback()
  if (panel) panel.scrollTop = scrollTop
}

function renderBanner(): void {
  const banner = bannerEl()
  if (!banner) return

  const analysis = currentAnalysis
  banner.hidden = !analysis || analysis.status === 'idle'
  banner.dataset.phase = analysis?.status ?? 'idle'

  if (!analysis || analysis.status === 'idle') return

  headlineEl()!.textContent =
    analysis.status === 'running'
      ? 'Agent 正在分析'
      : analysis.status === 'skipped_no_provider'
        ? '未配置模型，已使用本地规则完成分析'
        : analysis.status === 'cancelled'
          ? (analysis.headline ?? '扫描已停止')
          : analysis.status === 'failed'
            ? '智能分析失败'
            : analysis.headline ?? '智能建议已生成'

  overviewEl()!.textContent =
    analysis.status === 'running'
      ? 'Agent 自动分析扫描摘要并提供建议，由你确认后安全执行。'
      : analysis.status === 'skipped_no_provider'
        ? '当前结果来自已启用的本地规则和安全策略；配置模型后可增加 Agent 智能复核。'
        : analysis.status === 'cancelled'
          ? (analysis.overview ?? '未运行智能分析')
          : analysis.status === 'failed'
            ? `${analysis.errorMessage ?? '请稍后重试分析。'} 本地规则建议仍可使用。`
            : analysis.overview ?? 'Agent 自动分析扫描摘要并提供建议，由你确认后安全执行。'

  const metaParts: string[] = []
  if (analysis.status === 'completed') {
    metaParts.push(`已分析 ${analysis.analyzedCount} 项`)
    if (analysis.omittedCount > 0) metaParts.push(`另有 ${analysis.omittedCount} 项未送入模型`)
    if (analysis.skippedInvalidCount > 0) metaParts.push(`忽略 ${analysis.skippedInvalidCount} 条无效建议`)
  }
  metaEl()!.textContent = metaParts.join(' · ')

  const retry = retryBtn()
  const stop = stopBtn()
  const settings = settingsLink()
  if (retry) retry.hidden = analysis.status !== 'failed'
  if (stop) stop.hidden = analysis.status !== 'running'
  if (settings) settings.hidden = analysis.status !== 'skipped_no_provider'
}

export function resetAgentAnalysisUi(): void {
  analysisGeneration += 1
  activeRequest = null
  currentAnalysis = null
  autoAnalyzeSessionId = null
  resetInvestigationTimeline()
  const banner = bannerEl()
  if (banner) banner.hidden = true
}

export function onScanCancelledNoAnalysis(sessionId: string): void {
  currentAnalysis = {
    sessionId,
    status: 'cancelled',
    headline: '扫描已停止',
    overview: '未运行智能分析',
    analyzedCount: 0,
    omittedCount: 0,
    appliedCount: 0,
    skippedInvalidCount: 0
  }
  renderBanner()
}

export function onAgentAnalysisStart(sessionId: string): void {
  beginInvestigationTimeline(sessionId)
  currentAnalysis = {
    sessionId,
    status: 'running',
    analyzedCount: 0,
    omittedCount: 0,
    appliedCount: 0,
    skippedInvalidCount: 0
  }
  preservePanelScroll(() => renderBanner())
}

export function onAgentAnalysisComplete(analysis: AgentAnalysisPublic): void {
  currentAnalysis = analysis
  preservePanelScroll(() => renderBanner())
}

export function onAgentAnalysisFailed(sessionId: string, message: string): void {
  currentAnalysis = {
    sessionId,
    status: 'failed',
    analyzedCount: 0,
    omittedCount: 0,
    appliedCount: 0,
    skippedInvalidCount: 0,
    errorMessage: message
  }
  preservePanelScroll(() => renderBanner())
}

export function onAgentAnalysisCancelled(sessionId: string): void {
  const generation = getActiveTimelineGeneration()
  if (generation) {
    appendInvestigationTimelineEvent({
      schemaVersion: 1,
      type: 'cancelled',
      sessionId,
      generation,
      at: Date.now(),
      message: '智能分析已停止'
    })
  }
  currentAnalysis = {
    sessionId,
    status: 'cancelled',
    headline: '智能复核已停止',
    overview: '本地分析已完成，本地规则建议仍可使用。',
    analyzedCount: 0,
    omittedCount: 0,
    appliedCount: 0,
    skippedInvalidCount: 0
  }
  preservePanelScroll(() => renderBanner())
}

export interface AgentAnalysisCallbacks {
  onItemsUpdated: (items: ScanItem[]) => void | Promise<void>
  onFailed?: () => void | Promise<void>
  onCancelled?: () => void | Promise<void>
  onStart?: () => void
  openSettings: () => void
}

export function runAgentAnalysisForSession(
  sessionId: string,
  callbacks: AgentAnalysisCallbacks,
  options: { retry?: boolean } = {}
): Promise<void> {
  if (activeRequest?.sessionId === sessionId) {
    return activeRequest.promise
  }

  if (!options.retry && autoAnalyzeSessionId === sessionId && currentAnalysis?.status === 'completed') {
    return Promise.resolve()
  }

  if (options.retry) {
    const failedSessionId = currentAnalysis?.sessionId
    if (!failedSessionId || failedSessionId !== sessionId || currentAnalysis?.status !== 'failed') {
      return Promise.resolve()
    }
  }

  const generation = analysisGeneration
  autoAnalyzeSessionId = sessionId

  if (!isStaleGeneration(generation)) {
    onAgentAnalysisStart(sessionId)
    callbacks.onStart?.()
  }

  const promise = (async () => {
    try {
      const result = await window.diskClean.analyzeScan({
        sessionId,
        retry: options.retry === true
      })
      if (isStaleGeneration(generation)) return
      mergeInvestigationTimelineFromResult(
        sessionId,
        result.investigation?.generation,
        result.investigation?.timeline
      )
      onAgentAnalysisComplete(result.analysis)
      await callbacks.onItemsUpdated(result.items)
    } catch (error) {
      if (isStaleGeneration(generation)) return
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof Error && 'code' in error ? String((error as { code?: string }).code) : ''
      if (code === 'CANCELLED') {
        onAgentAnalysisCancelled(sessionId)
        await callbacks.onCancelled?.()
        return
      }
      onAgentAnalysisFailed(sessionId, message)
      await callbacks.onFailed?.()
    } finally {
      if (activeRequest?.generation === generation) {
        activeRequest = null
      }
    }
  })()

  activeRequest = { generation, sessionId, promise }
  return promise
}

export function wireAgentAnalysisUi(callbacks: AgentAnalysisCallbacks): void {
  wireInvestigationTimelineSubscription()
  retryBtn()?.addEventListener('click', () => {
    const sessionId = currentAnalysis?.sessionId
    if (!sessionId || currentAnalysis?.status !== 'failed') return
    void runAgentAnalysisForSession(sessionId, callbacks, { retry: true })
  })
  stopBtn()?.addEventListener('click', () => {
    if (currentAnalysis?.status !== 'running') return
    void window.diskClean.cancelAgentAnalysis()
  })
  settingsLink()?.addEventListener('click', () => callbacks.openSettings())
}

export function handleInvestigationTimelineEventForTests(
  event: Parameters<typeof appendInvestigationTimelineEvent>[0]
): void {
  appendInvestigationTimelineEvent(event)
}

export { getActiveTimelineGeneration }

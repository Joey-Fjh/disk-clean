import type { AgentAnalysisPublic } from '../shared/agent-types'
import type { ScanItem } from '../shared/types'

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
const settingsLink = () => document.getElementById('agent-analysis-settings-link') as HTMLButtonElement | null

export function getCurrentAgentAnalysis(): AgentAnalysisPublic | null {
  return currentAnalysis
}

export function shouldAutoAnalyzeAfterScan(cancelled: boolean): boolean {
  return !cancelled
}

function isStaleGeneration(generation: number): boolean {
  return generation !== analysisGeneration
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
        ? '未配置模型，本次仅完成本地空间发现'
        : analysis.status === 'cancelled'
          ? (analysis.headline ?? '扫描已停止')
          : analysis.status === 'failed'
            ? '智能分析失败'
            : analysis.headline ?? '智能建议已生成'

  overviewEl()!.textContent =
    analysis.status === 'running'
      ? 'Agent 自动分析扫描摘要并提供建议，由你确认后安全执行。'
      : analysis.status === 'skipped_no_provider'
        ? '配置模型连接后，可在扫描完成后获得智能清理建议。'
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
  const settings = settingsLink()
  if (retry) retry.hidden = analysis.status !== 'failed'
  if (settings) settings.hidden = analysis.status !== 'skipped_no_provider'
}

export function resetAgentAnalysisUi(): void {
  analysisGeneration += 1
  activeRequest = null
  currentAnalysis = null
  autoAnalyzeSessionId = null
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
  currentAnalysis = {
    sessionId,
    status: 'running',
    analyzedCount: 0,
    omittedCount: 0,
    appliedCount: 0,
    skippedInvalidCount: 0
  }
  renderBanner()
}

export function onAgentAnalysisComplete(analysis: AgentAnalysisPublic): void {
  currentAnalysis = analysis
  renderBanner()
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
  renderBanner()
}

export interface AgentAnalysisCallbacks {
  onItemsUpdated: (items: ScanItem[]) => void
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
  }

  const promise = (async () => {
    try {
      const result = await window.diskClean.analyzeScan({
        sessionId,
        retry: options.retry === true
      })
      if (isStaleGeneration(generation)) return
      onAgentAnalysisComplete(result.analysis)
      callbacks.onItemsUpdated(result.items)
    } catch (error) {
      if (isStaleGeneration(generation)) return
      const message = error instanceof Error ? error.message : String(error)
      onAgentAnalysisFailed(sessionId, message)
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
  retryBtn()?.addEventListener('click', () => {
    const sessionId = currentAnalysis?.sessionId
    if (!sessionId || currentAnalysis?.status !== 'failed') return
    void runAgentAnalysisForSession(sessionId, callbacks, { retry: true })
  })
  settingsLink()?.addEventListener('click', () => callbacks.openSettings())
}

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCurrentAgentAnalysis,
  onAgentAnalysisComplete,
  onAgentAnalysisFailed,
  onScanCancelledNoAnalysis,
  resetAgentAnalysisUi,
  runAgentAnalysisForSession,
  shouldAutoAnalyzeAfterScan
} from '../src/renderer/agent-analysis'

function setupBannerDom(): void {
  document.body.innerHTML = `
    <div id="agent-analysis-banner" hidden>
      <div id="agent-analysis-headline"></div>
      <div id="agent-analysis-overview"></div>
      <div id="agent-analysis-meta"></div>
      <button id="agent-analysis-retry" hidden></button>
      <button id="agent-analysis-settings-link" hidden></button>
    </div>
  `
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('agent analysis renderer state', () => {
  beforeEach(() => {
    setupBannerDom()
    resetAgentAnalysisUi()
    window.diskClean = {
      analyzeScan: vi.fn()
    } as unknown as typeof window.diskClean
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not auto-analyze after cancelled scan', () => {
    expect(shouldAutoAnalyzeAfterScan(true)).toBe(false)
    expect(shouldAutoAnalyzeAfterScan(false)).toBe(true)
  })

  it('shows scan-cancelled banner without running analysis', () => {
    onScanCancelledNoAnalysis('session-cancelled')
    const analysis = getCurrentAgentAnalysis()
    expect(analysis?.status).toBe('cancelled')
    expect(analysis?.overview).toContain('未运行智能分析')
  })

  it('mentions local rule suggestions when agent analysis fails', () => {
    onAgentAnalysisFailed('session-a', '模型鉴权失败')
    expect(document.getElementById('agent-analysis-overview')?.textContent).toContain(
      '本地规则建议仍可使用'
    )
  })

  it('describes local-rule completion when provider key is missing', () => {
    onAgentAnalysisComplete({
      sessionId: 'session-a',
      status: 'skipped_no_provider',
      analyzedCount: 0,
      omittedCount: 0,
      appliedCount: 0,
      skippedInvalidCount: 0
    })
    expect(document.getElementById('agent-analysis-headline')?.textContent).toContain(
      '已使用本地规则完成分析'
    )
    expect(document.getElementById('agent-analysis-overview')?.textContent).toContain(
      '本地规则和安全策略'
    )
  })

  it('does not let stale request failure overwrite newer scan UI', async () => {
    const first = deferred<{ analysis: { sessionId: string; status: 'completed'; analyzedCount: number; omittedCount: number; appliedCount: number; skippedInvalidCount: number; headline: string; overview: string }; items: [] }>()
    const second = deferred<{ analysis: { sessionId: string; status: 'completed'; analyzedCount: number; omittedCount: number; appliedCount: number; skippedInvalidCount: number; headline: string; overview: string }; items: [] }>()

    vi.mocked(window.diskClean.analyzeScan)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const callbacks = { onItemsUpdated: vi.fn(), openSettings: vi.fn() }
    const oldRun = runAgentAnalysisForSession('session-old', callbacks)
    resetAgentAnalysisUi()
    const newRun = runAgentAnalysisForSession('session-new', callbacks)

    first.resolve({
      analysis: {
        sessionId: 'session-old',
        status: 'completed',
        analyzedCount: 1,
        omittedCount: 0,
        appliedCount: 1,
        skippedInvalidCount: 0,
        headline: '旧会话',
        overview: '旧概述'
      },
      items: []
    })
    second.resolve({
      analysis: {
        sessionId: 'session-new',
        status: 'completed',
        analyzedCount: 1,
        omittedCount: 0,
        appliedCount: 1,
        skippedInvalidCount: 0,
        headline: '新会话',
        overview: '新概述'
      },
      items: []
    })

    await Promise.all([oldRun, newRun])
    expect(getCurrentAgentAnalysis()?.headline).toBe('新会话')
    expect(getCurrentAgentAnalysis()?.sessionId).toBe('session-new')
  })

  it('does not clear active promise for a newer request in stale finally', async () => {
    let rejectFirst!: (reason?: unknown) => void
    const firstPromise = new Promise<never>((_, reject) => {
      rejectFirst = reject
    })
    const second = deferred<{
      analysis: {
        sessionId: string
        status: 'completed'
        analyzedCount: number
        omittedCount: number
        appliedCount: number
        skippedInvalidCount: number
      }
      items: []
    }>()

    vi.mocked(window.diskClean.analyzeScan)
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => second.promise)

    const callbacks = { onItemsUpdated: vi.fn(), openSettings: vi.fn() }
    void runAgentAnalysisForSession('session-old', callbacks)
    resetAgentAnalysisUi()
    const newRun = runAgentAnalysisForSession('session-new', callbacks)

    rejectFirst(new Error('旧请求失败'))
    await Promise.resolve()

    second.resolve({
      analysis: {
        sessionId: 'session-new',
        status: 'completed',
        analyzedCount: 1,
        omittedCount: 0,
        appliedCount: 1,
        skippedInvalidCount: 0
      },
      items: []
    })

    await newRun
    expect(getCurrentAgentAnalysis()?.sessionId).toBe('session-new')
  })

  it('calls analyze only once while same session is running', async () => {
    const pending = deferred<{ analysis: { sessionId: string; status: 'completed'; analyzedCount: number; omittedCount: number; appliedCount: number; skippedInvalidCount: number }; items: [] }>()
    vi.mocked(window.diskClean.analyzeScan).mockImplementation(() => pending.promise)

    const callbacks = { onItemsUpdated: vi.fn(), openSettings: vi.fn() }
    const first = runAgentAnalysisForSession('session-a', callbacks)
    const second = runAgentAnalysisForSession('session-a', callbacks)

    expect(window.diskClean.analyzeScan).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)

    pending.resolve({
      analysis: {
        sessionId: 'session-a',
        status: 'completed',
        analyzedCount: 1,
        omittedCount: 0,
        appliedCount: 1,
        skippedInvalidCount: 0
      },
      items: []
    })
    await first
  })

  it('does not run retry concurrently with an in-flight request', async () => {
    const pending = deferred<{ analysis: { sessionId: string; status: 'completed'; analyzedCount: number; omittedCount: number; appliedCount: number; skippedInvalidCount: number }; items: [] }>()
    vi.mocked(window.diskClean.analyzeScan).mockImplementation(() => pending.promise)

    const callbacks = { onItemsUpdated: vi.fn(), openSettings: vi.fn() }
    const running = runAgentAnalysisForSession('session-a', callbacks)
    const retry = runAgentAnalysisForSession('session-a', callbacks, { retry: true })

    expect(window.diskClean.analyzeScan).toHaveBeenCalledTimes(1)
    expect(running).toBe(retry)

    pending.resolve({
      analysis: {
        sessionId: 'session-a',
        status: 'completed',
        analyzedCount: 1,
        omittedCount: 0,
        appliedCount: 1,
        skippedInvalidCount: 0
      },
      items: []
    })
    await running
  })
})

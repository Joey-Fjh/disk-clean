// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentAnalysisSessionCallbacks } from '../src/renderer/agent-session-lifecycle'
import { resolveTaskHeadline } from '../src/renderer/cleanup-task-ui'
import {
  getCurrentAgentAnalysis,
  onAgentAnalysisFailed,
  resetAgentAnalysisUi,
  runAgentAnalysisForSession,
  wireAgentAnalysisUi
} from '../src/renderer/agent-analysis'
import type { ScanItem } from '../src/shared/types'
import type { ScanTaskPhase } from '../src/renderer/scan-task-state'

function setupBannerDom(): void {
  document.body.innerHTML = `
    <div id="agent-analysis-banner" hidden>
      <div id="agent-analysis-headline"></div>
      <div id="agent-analysis-overview"></div>
      <div id="agent-analysis-meta"></div>
      <button id="agent-analysis-retry" hidden></button>
      <button id="agent-analysis-stop" hidden></button>
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

describe('agent session lifecycle callbacks', () => {
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

  it('runs failed → retry → analyzing → planning → completed', async () => {
    const phases: ScanTaskPhase[] = []
    let items: ScanItem[] = []
    const scanResult = { sessionId: 'session-retry', items }

    const callbacks = createAgentAnalysisSessionCallbacks({
      sessionId: 'session-retry',
      getScanResult: () => scanResult,
      setScanResult: (result) => {
        scanResult.items = result.items
        items = result.items
      },
      setTaskPhase: (phase) => phases.push(phase),
      refreshTaskProgress: vi.fn(),
      reconcileSelection: vi.fn(),
      renderCategories: vi.fn(),
      updateSelectedSummary: vi.fn(),
      preservePanelScroll: (fn) => fn(),
      openSettings: vi.fn()
    })

    onAgentAnalysisFailed('session-retry', '模型超时')
    expect(phases).toEqual([])

    const pending = deferred<{
      analysis: {
        sessionId: string
        status: 'completed'
        analyzedCount: number
        omittedCount: number
        appliedCount: number
        skippedInvalidCount: number
        headline: string
        overview: string
      }
      items: ScanItem[]
    }>()
    vi.mocked(window.diskClean.analyzeScan).mockImplementation(() => pending.promise)

    const retryRun = runAgentAnalysisForSession('session-retry', callbacks, { retry: true })
    expect(phases).toContain('analyzing')

    pending.resolve({
      analysis: {
        sessionId: 'session-retry',
        status: 'completed',
        analyzedCount: 1,
        omittedCount: 0,
        appliedCount: 1,
        skippedInvalidCount: 0,
        headline: '智能建议已生成',
        overview: '复核完成'
      },
      items: []
    })
    await retryRun

    expect(phases).toEqual(['analyzing', 'planning', 'completed'])
    expect(getCurrentAgentAnalysis()?.status).toBe('completed')
    expect(getCurrentAgentAnalysis()?.headline).toBe('智能建议已生成')
  })

  it('uses completed task phase when agent analysis is cancelled after scan', async () => {
    const phases: ScanTaskPhase[] = []
    const scanResult = { sessionId: 'session-cancel', items: [] as ScanItem[] }

    const callbacks = createAgentAnalysisSessionCallbacks({
      getScanResult: () => scanResult,
      setScanResult: (result) => {
        scanResult.items = result.items
      },
      setTaskPhase: (phase) => phases.push(phase),
      refreshTaskProgress: vi.fn(),
      reconcileSelection: vi.fn(),
      renderCategories: vi.fn(),
      updateSelectedSummary: vi.fn(),
      preservePanelScroll: (fn) => fn(),
      openSettings: vi.fn()
    })

    const cancelled = new Promise<never>((_, reject) => {
      reject(Object.assign(new Error('智能分析已取消'), { code: 'CANCELLED' }))
    })
    vi.mocked(window.diskClean.analyzeScan).mockImplementation(() => cancelled)

    await runAgentAnalysisForSession('session-cancel', callbacks)
    expect(phases).toEqual(['analyzing', 'completed'])
    expect(
      resolveTaskHeadline({
        phase: 'completed',
        driveLabel: 'C: 盘',
        discoveredCount: 3,
        agentStatus: 'cancelled'
      })
    ).toBe('本地分析完成，智能复核已停止')
  })
})

describe('agent retry wiring', () => {
  beforeEach(() => {
    setupBannerDom()
    resetAgentAnalysisUi()
    window.diskClean = {
      analyzeScan: vi.fn(),
      cancelAgentAnalysis: vi.fn()
    } as unknown as typeof window.diskClean
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retry button uses the same lifecycle callbacks as first analysis', async () => {
    const phases: ScanTaskPhase[] = []
    const scanResult = { sessionId: 'session-wire', items: [] as ScanItem[] }
    const callbacks = createAgentAnalysisSessionCallbacks({
      getScanResult: () => scanResult,
      setScanResult: (result) => {
        scanResult.items = result.items
      },
      setTaskPhase: (phase) => phases.push(phase),
      refreshTaskProgress: vi.fn(),
      reconcileSelection: vi.fn(),
      renderCategories: vi.fn(),
      updateSelectedSummary: vi.fn(),
      preservePanelScroll: (fn) => fn(),
      openSettings: vi.fn()
    })

    wireAgentAnalysisUi(callbacks)
    onAgentAnalysisFailed('session-wire', '网络错误')

    const pending = deferred<{
      analysis: {
        sessionId: string
        status: 'completed'
        analyzedCount: number
        omittedCount: number
        appliedCount: number
        skippedInvalidCount: number
      }
      items: ScanItem[]
    }>()
    vi.mocked(window.diskClean.analyzeScan).mockImplementation(() => pending.promise)

    document.getElementById('agent-analysis-retry')?.click()
    expect(phases).toContain('analyzing')

    pending.resolve({
      analysis: {
        sessionId: 'session-wire',
        status: 'completed',
        analyzedCount: 1,
        omittedCount: 0,
        appliedCount: 1,
        skippedInvalidCount: 0
      },
      items: []
    })
    await vi.waitFor(() => {
      expect(phases).toEqual(['analyzing', 'planning', 'completed'])
    })
    expect(window.diskClean.analyzeScan).toHaveBeenCalledWith({
      sessionId: 'session-wire',
      retry: true
    })
  })
})

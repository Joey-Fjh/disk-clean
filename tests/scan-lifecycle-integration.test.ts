// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  onAgentAnalysisCancelled,
  onAgentAnalysisComplete,
  resetAgentAnalysisUi
} from '../src/renderer/agent-analysis'
import { createAgentAnalysisSessionCallbacks } from '../src/renderer/agent-session-lifecycle'
import { resolveScanProgressTaskPhase } from '../src/renderer/scan-task-state'
import { applyResultsReadyPipeline, TaskPipelineState } from '../src/renderer/task-pipeline-state'
import { resolveScanFailureRecovery } from '../src/renderer/task-ui-recovery'
import {
  applyProgressBarMode,
  renderTaskPipeline
} from '../src/renderer/ux-flow-render'
import {
  resolveActivePipelineStep,
  resolvePipelineStepState,
  resolveProgressBarMode,
  shouldShowTaskPipeline
} from '../src/shared/ux-flow-model'
import type { ScanTaskPhase } from '../src/shared/cleanup-task-model'
import type { ScanItem, ScanResult } from '../src/shared/types'

function mockItem(): ScanItem {
  return {
    id: 'item-1',
    ruleId: 'rule-a',
    ruleName: 'Temp',
    category: 'safe',
    contentType: 'app-cache',
    drive: 'C:',
    path: 'C:\\Temp\\cache',
    size: 1024,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    deletable: true,
    autoSelect: true,
    source: 'rule',
    reason: 'cache',
    discoverySources: ['rule'],
    evidence: [],
    judgment: { status: 'suggested', source: 'rule', confidence: 'high', basis: [] },
    selection: { selectable: true },
    suggestedAction: 'recycle'
  }
}

function mockScanResult(items: ScanItem[]): ScanResult {
  return {
    sessionId: 'session-1',
    drive: 'C:',
    items,
    errors: [],
    cancelled: false,
    scannedAt: Date.now()
  }
}

function simulateUpdateProgressUI(input: {
  phase: ScanTaskPhase
  isPostCleanupRescan: boolean
  scanPhase?: 'space-discovery' | 'rule-identification'
}): ScanTaskPhase {
  return resolveScanProgressTaskPhase({
    currentPhase: input.phase,
    isPostCleanupRescan: input.isPostCleanupRescan,
    scanPhase: input.scanPhase,
    agentReviewing: false
  })
}

function createMainStyleResultsReadyHook(pipeline: TaskPipelineState) {
  return (items: ScanItem[], analysisStatus?: Parameters<typeof applyResultsReadyPipeline>[1]) => {
    applyResultsReadyPipeline(pipeline, analysisStatus)
    return items.length
  }
}

describe('scan lifecycle integration', () => {
  it('keeps rescanning phase across repeated scan progress callbacks', () => {
    let phase: ScanTaskPhase = 'rescanning'

    phase = simulateUpdateProgressUI({
      phase,
      isPostCleanupRescan: true,
      scanPhase: 'space-discovery'
    })
    expect(phase).toBe('rescanning')
    expect(
      resolveActivePipelineStep({
        phase,
        hasScanResults: true,
        milestone: 'execute'
      })
    ).toBe('review')

    phase = simulateUpdateProgressUI({
      phase,
      isPostCleanupRescan: true,
      scanPhase: 'rule-identification'
    })
    expect(phase).toBe('rescanning')
    expect(
      resolveActivePipelineStep({
        phase,
        hasScanResults: true,
        milestone: 'execute'
      })
    ).toBe('review')
  })

  it('maps ordinary scan progress to scanning and organizing', () => {
    let phase: ScanTaskPhase = 'scanning'

    phase = simulateUpdateProgressUI({
      phase,
      isPostCleanupRescan: false,
      scanPhase: 'space-discovery'
    })
    expect(phase).toBe('scanning')

    phase = simulateUpdateProgressUI({
      phase,
      isPostCleanupRescan: false,
      scanPhase: 'rule-identification'
    })
    expect(phase).toBe('organizing')
  })

  it('marks analyze skipped when results ready receives skipped_no_provider', async () => {
    resetAgentAnalysisUi()
    const pipeline = new TaskPipelineState()
    pipeline.advance('scan')
    const onResultsReady = createMainStyleResultsReadyHook(pipeline)

    onAgentAnalysisComplete({
      sessionId: 'session-1',
      status: 'skipped_no_provider',
      analyzedCount: 0,
      omittedCount: 0,
      appliedCount: 0,
      skippedInvalidCount: 0
    })

    const callbacks = createAgentAnalysisSessionCallbacks({
      sessionId: 'session-1',
      getScanResult: () => mockScanResult([mockItem()]),
      setScanResult: () => {},
      setTaskPhase: () => {},
      refreshTaskProgress: () => {},
      reconcileSelection: async () => {},
      renderCategories: () => {},
      updateSelectedSummary: () => {},
      preservePanelScroll: (fn) => fn(),
      openSettings: () => {},
      onResultsReady
    })

    await callbacks.onItemsUpdated?.([mockItem()])

    expect(pipeline.isAnalyzeSkipped()).toBe(true)
    expect(resolvePipelineStepState('analyze', {
      activeStep: null,
      phase: 'completed',
      milestone: pipeline.getMilestone(),
      analyzeSkipped: pipeline.isAnalyzeSkipped()
    })).toBe('skipped')
  })

  it('marks analyze skipped when user cancels agent analysis', async () => {
    resetAgentAnalysisUi()
    const pipeline = new TaskPipelineState()
    pipeline.advance('scan')
    const onResultsReady = createMainStyleResultsReadyHook(pipeline)

    onAgentAnalysisCancelled('session-1')

    const callbacks = createAgentAnalysisSessionCallbacks({
      sessionId: 'session-1',
      getScanResult: () => mockScanResult([mockItem()]),
      setScanResult: () => {},
      setTaskPhase: () => {},
      refreshTaskProgress: () => {},
      reconcileSelection: async () => {},
      renderCategories: () => {},
      updateSelectedSummary: () => {},
      preservePanelScroll: (fn) => fn(),
      openSettings: () => {},
      onResultsReady
    })

    await callbacks.onCancelled?.()

    expect(pipeline.isAnalyzeSkipped()).toBe(true)
    expect(resolvePipelineStepState('analyze', {
      activeStep: null,
      phase: 'completed',
      milestone: pipeline.getMilestone(),
      analyzeSkipped: pipeline.isAnalyzeSkipped()
    })).toBe('skipped')
  })

  it('advances analyze when agent analysis completes successfully', async () => {
    resetAgentAnalysisUi()
    const pipeline = new TaskPipelineState()
    pipeline.advance('scan')
    const onResultsReady = createMainStyleResultsReadyHook(pipeline)

    onAgentAnalysisComplete({
      sessionId: 'session-1',
      status: 'completed',
      analyzedCount: 1,
      omittedCount: 0,
      appliedCount: 1,
      skippedInvalidCount: 0
    })

    const callbacks = createAgentAnalysisSessionCallbacks({
      sessionId: 'session-1',
      getScanResult: () => mockScanResult([mockItem()]),
      setScanResult: () => {},
      setTaskPhase: () => {},
      refreshTaskProgress: () => {},
      reconcileSelection: async () => {},
      renderCategories: () => {},
      updateSelectedSummary: () => {},
      preservePanelScroll: (fn) => fn(),
      openSettings: () => {},
      onResultsReady
    })

    await callbacks.onItemsUpdated?.([mockItem()])

    expect(pipeline.isAnalyzeSkipped()).toBe(false)
    expect(resolvePipelineStepState('analyze', {
      activeStep: null,
      phase: 'completed',
      milestone: pipeline.getMilestone(),
      analyzeSkipped: pipeline.isAnalyzeSkipped()
    })).toBe('done')
  })

  it('clears active scan pipeline after ordinary scan failure', () => {
    const recovery = resolveScanFailureRecovery(false)
    expect(recovery).toEqual({ phase: 'idle', progressHidden: true })

    const progress = document.createElement('section')
    progress.hidden = false
    const fill = document.createElement('div')
    progress.innerHTML = '<div class="progress-bar" role="progressbar"></div>'
    progress.appendChild(fill)

    const pipeline = document.createElement('div')
    document.body.append(progress, pipeline)

    // Production bug order: refresh while scanning is still true re-shows the bar.
    applyProgressBarMode(
      progress,
      fill,
      resolveProgressBarMode({ scanning: true, phase: recovery.phase })
    )
    expect(progress.hidden).toBe(false)

    // Fixed order: end scanning, then refresh UI.
    applyProgressBarMode(
      progress,
      fill,
      resolveProgressBarMode({ scanning: false, phase: recovery.phase })
    )
    renderTaskPipeline(pipeline, {
      phase: recovery.phase,
      scanning: false,
      hasScanResults: false
    })

    expect(progress.hidden).toBe(true)
    expect(pipeline.hidden).toBe(true)
    expect(
      shouldShowTaskPipeline({
        phase: recovery.phase,
        scanning: false,
        hasScanResults: false
      })
    ).toBe(false)
    expect(
      resolveActivePipelineStep({
        phase: recovery.phase,
        hasScanResults: false
      })
    ).toBeNull()

    progress.remove()
    pipeline.remove()
  })

  it('keeps determinate progress when generic refresh preserves scan phase', () => {
    const progress = document.createElement('section')
    progress.hidden = false
    const fill = document.createElement('div')
    progress.innerHTML = '<div class="progress-bar" role="progressbar"></div>'
    progress.appendChild(fill)

    const withPhase = resolveProgressBarMode({
      scanning: true,
      phase: 'organizing',
      scanPhase: 'rule-identification'
    })
    const withoutPhase = resolveProgressBarMode({
      scanning: true,
      phase: 'organizing'
    })

    expect(withPhase).toBe('determinate')
    expect(withoutPhase).toBe('indeterminate')

    applyProgressBarMode(progress, fill, withPhase, 65)
    expect(progress.classList.contains('progress-indeterminate')).toBe(false)
    expect(fill.style.width).toBe('65%')

    applyProgressBarMode(progress, fill, withoutPhase)
    expect(progress.classList.contains('progress-indeterminate')).toBe(true)

    progress.remove()
  })

  it('restores resting pipeline after post-cleanup rescan failure', () => {
    const recovery = resolveScanFailureRecovery(true)
    expect(recovery).toEqual({ phase: 'completed', progressHidden: true })

    const progress = document.createElement('section')
    progress.hidden = false
    const fill = document.createElement('div')
    progress.innerHTML = '<div class="progress-bar" role="progressbar"></div>'
    progress.appendChild(fill)

    const pipeline = document.createElement('div')
    document.body.append(progress, pipeline)

    applyProgressBarMode(
      progress,
      fill,
      resolveProgressBarMode({ scanning: true, phase: 'rescanning' })
    )
    expect(progress.hidden).toBe(false)

    applyProgressBarMode(
      progress,
      fill,
      resolveProgressBarMode({ scanning: false, phase: recovery.phase })
    )
    renderTaskPipeline(pipeline, {
      phase: recovery.phase,
      scanning: false,
      hasScanResults: false,
      milestone: 'execute'
    })

    expect(progress.hidden).toBe(true)
    expect(pipeline.hidden).toBe(false)
    expect(
      resolveActivePipelineStep({
        phase: recovery.phase,
        hasScanResults: false,
        milestone: 'execute'
      })
    ).toBe('execute')
    expect(
      resolvePipelineStepState('execute', {
        activeStep: null,
        phase: recovery.phase,
        milestone: 'execute'
      })
    ).toBe('done')

    progress.remove()
    pipeline.remove()
  })
})

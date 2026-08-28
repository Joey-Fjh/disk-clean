// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createAgentAnalysisSessionCallbacks } from '../src/renderer/agent-session-lifecycle'
import { TaskPipelineState } from '../src/renderer/task-pipeline-state'
import { resolveInteractiveTaskRecovery } from '../src/renderer/task-ui-recovery'
import { applyProgressBarMode } from '../src/renderer/ux-flow-render'
import {
  resolveActivePipelineStep,
  resolvePipelineStepState,
  shouldShowFinalResultCategories
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

describe('ux flow lifecycle dom', () => {
  it('agent completion renders final categories after planning completes', async () => {
    let phase: ScanTaskPhase = 'analyzing'
    const categoriesEl = document.createElement('div')
    document.body.appendChild(categoriesEl)

    const callbacks = createAgentAnalysisSessionCallbacks({
      sessionId: 'session-1',
      getScanResult: () => mockScanResult([mockItem()]),
      setScanResult: () => {},
      setTaskPhase: (next) => {
        phase = next
      },
      refreshTaskProgress: () => {},
      reconcileSelection: async () => {},
      renderCategories: () => {
        if (
          !shouldShowFinalResultCategories({
            scanning: false,
            phase,
            agentReviewing: false
          })
        ) {
          return
        }
        categoriesEl.innerHTML = '<div class="result-panel">ready</div>'
      },
      updateSelectedSummary: () => {},
      preservePanelScroll: (fn) => fn(),
      openSettings: () => {}
    })

    await callbacks.onItemsUpdated?.([mockItem()])

    expect(phase).toBe('completed')
    expect(categoriesEl.querySelector('.result-panel')).not.toBeNull()
    categoriesEl.remove()
  })

  it('no-key completion path renders after completed phase is set', async () => {
    let phase: ScanTaskPhase = 'planning'
    const categoriesEl = document.createElement('div')
    document.body.appendChild(categoriesEl)

    const renderIfReady = () => {
      if (
        !shouldShowFinalResultCategories({
          scanning: false,
          phase,
          agentReviewing: false
        })
      ) {
        return
      }
      categoriesEl.innerHTML = '<div class="result-panel">ready</div>'
    }

    renderIfReady()
    expect(categoriesEl.querySelector('.result-panel')).toBeNull()

    phase = 'completed'
    renderIfReady()
    expect(categoriesEl.querySelector('.result-panel')).not.toBeNull()
    categoriesEl.remove()
  })

  it('keeps rescanning as the active pipeline step during auto review scan', () => {
    expect(
      resolveActivePipelineStep({
        phase: 'rescanning',
        hasScanResults: true,
        milestone: 'execute'
      })
    ).toBe('review')
  })

  it('restores interactive task state after cleanup plan failure', () => {
    const recovery = resolveInteractiveTaskRecovery(12)
    expect(recovery.phase).toBe('completed')
    expect(recovery.progressHidden).toBe(true)
  })

  it('records pipeline milestone through execute and review', () => {
    const pipeline = new TaskPipelineState()
    pipeline.advance('scan')
    pipeline.markAnalyzeSkipped()
    pipeline.advance('suggest')
    pipeline.advance('execute')
    pipeline.advance('review')

    expect(resolvePipelineStepState('scan', {
      activeStep: null,
      phase: 'completed',
      milestone: pipeline.getMilestone(),
      analyzeSkipped: pipeline.isAnalyzeSkipped()
    })).toBe('done')
    expect(resolvePipelineStepState('analyze', {
      activeStep: null,
      phase: 'completed',
      milestone: pipeline.getMilestone(),
      analyzeSkipped: pipeline.isAnalyzeSkipped()
    })).toBe('skipped')
    expect(resolvePipelineStepState('review', {
      activeStep: null,
      phase: 'completed',
      milestone: pipeline.getMilestone(),
      analyzeSkipped: pipeline.isAnalyzeSkipped()
    })).toBe('done')
  })

  it('updates progressbar aria values for determinate mode', () => {
    const progress = document.createElement('section')
    progress.innerHTML = '<div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill"></div></div>'
    const fill = progress.querySelector('.progress-fill') as HTMLElement
    applyProgressBarMode(progress, fill, 'determinate', 42)
    const bar = progress.querySelector('.progress-bar')
    expect(bar?.getAttribute('aria-valuenow')).toBe('42')
    expect(bar?.getAttribute('aria-valuetext')).toBe('42%')
  })
})

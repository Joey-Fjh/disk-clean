// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderCleanupOutcomePanel, renderTaskPipeline } from '../src/renderer/ux-flow-render'
import type { CleanupOutcomeManifest } from '../src/renderer/cleanup-result-state'

function manifest(partial?: Partial<CleanupOutcomeManifest>): CleanupOutcomeManifest {
  return {
    sessionId: 's1',
    succeededPaths: ['C:\\a'],
    executionFailed: [],
    executionRejected: [],
    prepareRejected: [],
    result: {
      moved: 1,
      movedToTrashBytes: 100,
      skipped: 0,
      succeeded: ['C:\\a'],
      errors: [],
      rejected: []
    },
    completedAt: Date.now(),
    ...partial
  }
}

describe('ux flow render', () => {
  it('renders pipeline steps for active scan', () => {
    const el = document.createElement('nav')
    renderTaskPipeline(el, { phase: 'scanning', scanning: true, hasScanResults: false })
    expect(el.hidden).toBe(false)
    expect(el.querySelectorAll('.task-pipeline-step').length).toBe(5)
    expect(el.querySelector('.task-pipeline-step.is-active')?.textContent).toContain('扫描识别')
  })

  it('marks completed milestones as done steps', () => {
    const el = document.createElement('nav')
    renderTaskPipeline(el, {
      phase: 'completed',
      scanning: false,
      hasScanResults: true,
      milestone: 'review',
      analyzeSkipped: true
    })
    expect(el.querySelector('[data-step="review"]')?.classList.contains('is-done')).toBe(true)
    expect(el.querySelector('[data-step="analyze"]')?.classList.contains('is-skipped')).toBe(true)
    expect(el.querySelector('[data-step="analyze"] .task-pipeline-skip-note')?.textContent).toBe('已跳过')
  })

  it('renders cleanup outcome panel with comparison detail', () => {
    const panel = document.createElement('section')
    renderCleanupOutcomePanel(panel, manifest(), '重扫对比：1 项已消失')
    expect(panel.hidden).toBe(false)
    expect(panel.querySelector('.cleanup-outcome-title')?.textContent).toBe('清理完成')
    expect(panel.querySelector('.cleanup-outcome-comparison')?.textContent).toContain('重扫对比')
  })

  it('clears outcome panel when manifest is null', () => {
    const panel = document.createElement('section')
    renderCleanupOutcomePanel(panel, manifest())
    renderCleanupOutcomePanel(panel, null)
    expect(panel.hidden).toBe(true)
    expect(panel.childElementCount).toBe(0)
  })
})

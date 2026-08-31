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

  it('uses warning headline when rescan still finds executed items', () => {
    const panel = document.createElement('section')
    renderCleanupOutcomePanel(
      panel,
      manifest(),
      '重扫对比：0 项已消失；1 项仍存在',
      {
        disappeared: [],
        stillPresent: ['C:\\a'],
        failed: [],
        prepareRejected: [],
        executionRejected: []
      }
    )
    expect(panel.classList.contains('tone-partial')).toBe(true)
    expect(panel.querySelector('.cleanup-outcome-title')?.textContent).toBe(
      '清理已执行，复核发现项目仍存在'
    )
    expect(panel.textContent).toContain('项目可能已被程序重新生成')
    expect(panel.querySelector('.cleanup-outcome-comparison')).toBeNull()
    expect(panel.textContent).toContain('复核结果：0 项已消失，1 项仍存在')
  })

  it('renders success outcome without duplicate comparison paragraph', () => {
    const panel = document.createElement('section')
    renderCleanupOutcomePanel(
      panel,
      manifest(),
      '重扫对比：1 项已消失',
      {
        disappeared: ['C:\\a'],
        stillPresent: [],
        failed: [],
        prepareRejected: [],
        executionRejected: []
      }
    )
    expect(panel.querySelector('.cleanup-outcome-comparison')).toBeNull()
    expect(panel.textContent).toContain('复核结果：1 项已消失，0 项仍存在')
  })

  it('clears outcome panel when manifest is null', () => {
    const panel = document.createElement('section')
    renderCleanupOutcomePanel(panel, manifest())
    renderCleanupOutcomePanel(panel, null)
    expect(panel.hidden).toBe(true)
    expect(panel.childElementCount).toBe(0)
  })
})

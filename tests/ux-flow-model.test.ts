import { describe, expect, it } from 'vitest'
import {
  buildCleanupOutcomeDetailLines,
  buildCleanupOutcomeHeadline,
  resolveActivePipelineStep,
  resolvePipelineStepState,
  resolveProgressBarMode,
  resolveUserFacingJudgmentSource,
  shouldShowExtensionEntryForCategory,
  shouldShowFinalResultCategories,
  shouldShowTaskPipeline
} from '../src/shared/ux-flow-model'
import type { ScanItem } from '../src/shared/types'

function item(partial: Partial<ScanItem> & Pick<ScanItem, 'id' | 'path'>): ScanItem {
  return {
    id: partial.id,
    path: partial.path,
    drive: partial.drive ?? 'C:',
    size: partial.size ?? 100,
    category: partial.category ?? 'safe',
    ruleId: partial.ruleId ?? 'test',
    ruleName: partial.ruleName ?? 'Test',
    contentType: partial.contentType ?? 'cache',
    reason: partial.reason ?? 'test',
    impact: partial.impact ?? 'low',
    source: partial.source ?? 'rule',
    discoverySources: partial.discoverySources ?? ['rule'],
    deletable: partial.deletable ?? true,
    defaultChecked: partial.defaultChecked ?? true,
    judgment: partial.judgment,
    agentInsight: partial.agentInsight,
    selection: partial.selection ?? { selectable: true, autoSelect: true },
    requiresAppClosed: partial.requiresAppClosed ?? false,
    snapshotComplete: partial.snapshotComplete ?? true,
    entryKind: partial.entryKind ?? 'file',
    sizePartial: partial.sizePartial ?? false
  } as ScanItem
}

describe('ux flow model', () => {
  it('hides final categories while scanning or analyzing', () => {
    expect(
      shouldShowFinalResultCategories({ scanning: true, phase: 'scanning', agentReviewing: false })
    ).toBe(false)
    expect(
      shouldShowFinalResultCategories({ scanning: false, phase: 'analyzing', agentReviewing: true })
    ).toBe(false)
    expect(
      shouldShowFinalResultCategories({ scanning: false, phase: 'completed', agentReviewing: false })
    ).toBe(true)
  })

  it('maps judgment sources for user-facing labels', () => {
    expect(
      resolveUserFacingJudgmentSource(
        item({
          id: '1',
          path: 'C:\\a',
          judgment: { status: 'suggested', judgmentOrigin: 'local-rule', source: 'rule', confidence: 'high' }
        })
      )
    ).toBe('本地规则')
    expect(
      resolveUserFacingJudgmentSource(
        item({
          id: '2',
          path: 'C:\\b',
          judgment: {
            status: 'suggested',
            judgmentOrigin: 'local-rule-agent-reviewed',
            source: 'agent',
            confidence: 'high'
          }
        })
      )
    ).toBe('本地规则 + Agent')
    expect(
      resolveUserFacingJudgmentSource(
        item({
          id: '3',
          path: 'C:\\c',
          judgment: { status: 'keep', judgmentOrigin: 'protected-policy', source: 'rule', confidence: 'high' }
        })
      )
    ).toBe('安全策略')
  })

  it('resolves pipeline step states', () => {
    expect(resolveActivePipelineStep({ phase: 'executing', hasScanResults: true })).toBe('execute')
    expect(
      resolvePipelineStepState('scan', {
        activeStep: 'execute',
        phase: 'executing'
      })
    ).toBe('done')
    expect(
      resolvePipelineStepState('execute', {
        activeStep: 'execute',
        phase: 'executing'
      })
    ).toBe('active')
    expect(
      resolvePipelineStepState('review', {
        activeStep: 'execute',
        phase: 'executing'
      })
    ).toBe('pending')
  })

  it('marks analyze as skipped when milestone reached without agent', () => {
    expect(
      resolvePipelineStepState('analyze', {
        activeStep: null,
        phase: 'completed',
        milestone: 'suggest',
        analyzeSkipped: true
      })
    ).toBe('skipped')
  })

  it('uses indeterminate progress for space discovery and execution', () => {
    expect(
      resolveProgressBarMode({ scanning: true, phase: 'scanning', scanPhase: 'space-discovery' })
    ).toBe('indeterminate')
    expect(resolveProgressBarMode({ scanning: false, phase: 'executing' })).toBe('indeterminate')
    expect(
      resolveProgressBarMode({ scanning: true, phase: 'scanning', scanPhase: 'rule-identification' })
    ).toBe('determinate')
  })

  it('builds cleanup outcome headlines for partial failure', () => {
    const input = {
      moved: 2,
      movedToTrashBytes: 1024,
      prepareRejectedCount: 1,
      executionFailedCount: 0,
      executionRejectedCount: 0
    }
    expect(buildCleanupOutcomeHeadline(input)).toBe('部分项目已移入回收站')
    expect(buildCleanupOutcomeDetailLines(input).some((line) => line.includes('回收站'))).toBe(true)
  })

  it('limits extension entry to space occupancy category', () => {
    expect(shouldShowExtensionEntryForCategory('space-occupancy')).toBe(true)
    expect(shouldShowExtensionEntryForCategory('caution-clean')).toBe(false)
  })

  it('shows pipeline when task is active or results exist', () => {
    expect(shouldShowTaskPipeline({ phase: 'idle', scanning: false, hasScanResults: false })).toBe(false)
    expect(shouldShowTaskPipeline({ phase: 'idle', scanning: false, hasScanResults: true })).toBe(true)
    expect(shouldShowTaskPipeline({ phase: 'scanning', scanning: true, hasScanResults: false })).toBe(true)
  })
})

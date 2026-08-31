import { describe, expect, it } from 'vitest'
import {
  buildCleanupOutcomeManifest,
  buildCleanupOutcomeSummaryInput,
  buildCleanupRescanComparison,
  formatCleanupOutcomeSummary,
  formatCleanupRescanComparison
} from '../src/renderer/cleanup-result-state'
import {
  buildCleanupOutcomeHeadline,
  resolveCleanupOutcomeTone
} from '../src/shared/ux-flow-model'
import type { CleanupResult, ScanItem } from '../src/shared/types'

function baseResult(overrides: Partial<CleanupResult> = {}): CleanupResult {
  return {
    planId: 'p1',
    estimatedLogicalBytes: 200,
    movedToTrashBytes: 200,
    actuallyReclaimedBytes: 0,
    reclaimState: 'pending',
    recoveryMode: 'recycle-bin',
    moved: 1,
    skipped: 0,
    failed: 0,
    succeeded: ['C:\\Temp\\a'],
    errors: [],
    rejected: [],
    postReview: {
      removedCount: 1,
      stillPresentCount: 0,
      failedCount: 0,
      disappearedPaths: ['C:\\Temp\\a'],
      stillPresentPaths: [],
      failedPaths: []
    },
    ...overrides
  }
}

describe('cleanup result lifecycle', () => {
  it('formats cleanup summary from manifest', () => {
    const manifest = buildCleanupOutcomeManifest({
      sessionId: 's1',
      selectedItems: [{ id: 'c1', path: 'C:\\Temp\\a' }],
      preview: { approvedCandidateIds: ['c1'], rejectedAtPrepare: [] },
      result: baseResult()
    })
    const summary = formatCleanupOutcomeSummary(manifest)
    expect(summary).toContain('已移入回收站')
    expect(summary).toContain('已消失 1')
  })

  it('tracks prepare rejections separately from execution outcomes', () => {
    const manifest = buildCleanupOutcomeManifest({
      sessionId: 's1',
      selectedItems: [
        { id: 'c1', path: 'C:\\approved' },
        { id: 'c2', path: 'C:\\rejected' }
      ],
      preview: {
        approvedCandidateIds: ['c1'],
        rejectedAtPrepare: [{ candidateId: 'c2', message: '未授权', code: 'NOT_AUTHORIZED' }]
      },
      result: baseResult({ succeeded: ['C:\\approved'] })
    })
    expect(manifest.prepareRejected).toHaveLength(1)
    expect(manifest.prepareRejected[0]?.path).toBe('C:\\rejected')
    expect(manifest.succeededPaths).toEqual(['C:\\approved'])
  })

  it('does not count prepare-rejected paths as cleanup success on rescan', () => {
    const manifest = buildCleanupOutcomeManifest({
      sessionId: 's1',
      selectedItems: [
        { id: 'c1', path: 'C:\\gone' },
        { id: 'c2', path: 'C:\\not-run' }
      ],
      preview: {
        approvedCandidateIds: ['c1'],
        rejectedAtPrepare: [{ candidateId: 'c2', message: '未授权', code: 'NOT_AUTHORIZED' }]
      },
      result: baseResult({ succeeded: ['C:\\gone'] })
    })

    const afterItems: ScanItem[] = []
    const comparison = buildCleanupRescanComparison(manifest, afterItems)
    expect(comparison.disappeared).toEqual(['C:\\gone'])
    expect(comparison.prepareRejected).toEqual(['C:\\not-run'])
    expect(comparison.stillPresent).toEqual([])
  })

  it('compares succeeded paths with Windows path normalization', () => {
    const manifest = buildCleanupOutcomeManifest({
      sessionId: 's1',
      selectedItems: [{ id: 'c1', path: 'C:\\stay' }],
      preview: { approvedCandidateIds: ['c1'], rejectedAtPrepare: [] },
      result: baseResult({ succeeded: ['C:\\stay'] })
    })

    const afterItems: ScanItem[] = [
      {
        id: 'stay',
        ruleId: 'r',
        ruleName: 'R',
        category: 'safe',
        contentType: 'app-cache',
        drive: 'C:',
        path: 'c:/stay',
        size: 50,
        sizeIsEstimate: true,
        snapshotComplete: true,
        entryKind: 'file',
        deletable: false,
        autoSelect: false,
        source: 'analyzer',
        discoverySources: ['space-scan'],
        evidence: [],
        judgment: {
          status: 'uncertain',
          source: 'none',
          confidence: 'unknown',
          basis: []
        },
        selection: { selectable: false },
        suggestedAction: 'none'
      }
    ]

    const comparison = buildCleanupRescanComparison(manifest, afterItems)
    expect(comparison.stillPresent).toEqual(['C:\\stay'])
    expect(formatCleanupRescanComparison(comparison)).toContain('1 项仍存在')
  })

  it('builds warning outcome summary when rescan still finds executed paths', () => {
    const manifest = buildCleanupOutcomeManifest({
      sessionId: 's1',
      selectedItems: [{ id: 'c1', path: 'C:\\stay' }],
      preview: { approvedCandidateIds: ['c1'], rejectedAtPrepare: [] },
      result: baseResult({ succeeded: ['C:\\stay'] })
    })
    const comparison = buildCleanupRescanComparison(manifest, [
      {
        id: 'stay',
        ruleId: 'r',
        ruleName: 'R',
        category: 'safe',
        contentType: 'app-cache',
        drive: 'C:',
        path: 'C:\\stay',
        size: 50,
        sizeIsEstimate: true,
        snapshotComplete: true,
        entryKind: 'file',
        deletable: false,
        autoSelect: false,
        source: 'rule',
        discoverySources: ['rule'],
        evidence: [],
        judgment: {
          status: 'suggested',
          source: 'rule',
          confidence: 'high',
          basis: []
        },
        selection: { selectable: true },
        suggestedAction: 'recycle'
      }
    ])
    const summary = buildCleanupOutcomeSummaryInput(manifest, comparison)
    expect(resolveCleanupOutcomeTone(summary)).toBe('partial')
    expect(buildCleanupOutcomeHeadline(summary)).toBe('清理已执行，复核发现项目仍存在')
  })

  it('tracks execution failures without treating them as rescan disappeared', () => {
    const manifest = buildCleanupOutcomeManifest({
      sessionId: 's1',
      selectedItems: [{ id: 'c1', path: 'C:\\fail' }],
      preview: { approvedCandidateIds: ['c1'], rejectedAtPrepare: [] },
      result: baseResult({
        moved: 0,
        failed: 1,
        succeeded: [],
        errors: [{ path: 'C:\\fail', message: 'stale', code: 'SNAPSHOT_STALE' }]
      })
    })

    const comparison = buildCleanupRescanComparison(manifest, [])
    expect(comparison.failed).toEqual(['C:\\fail'])
    expect(comparison.disappeared).toEqual([])
    expect(formatCleanupRescanComparison(comparison)).toContain('1 项执行失败')
  })
})

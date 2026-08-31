import { describe, expect, it } from 'vitest'
import {
  abandonPostCleanupRescanContext,
  applyPostCleanupRescanFailure,
  applyPostCleanupRescanFinish,
  beginPostCleanupRescanSession,
  buildPostCleanupRescanScanOptions,
  canRetryPostCleanupRescan,
  commitScanPreflight,
  createPostCleanupRescanSession,
  planScanPreflight,
  reducePostCleanupRescanSession,
  resolvePersistentCleanupStatusText,
  resolveScanInitializationStatusText,
  shouldSkipAutoAgentForScan
} from '../src/renderer/post-cleanup-rescan-controller'
import {
  formatPostCleanupRescanStatus,
  shouldApplyPostCleanupRescanComparison,
  shouldRetainCleanupSummary
} from '../src/renderer/cleanup-rescan-lifecycle'
import type { CleanupOutcomeManifest } from '../src/renderer/cleanup-result-state'

const baseSummary = '清理完成：已移入回收站 1 项'

function sampleManifest(): CleanupOutcomeManifest {
  return {
    sessionId: 's1',
    succeededPaths: ['C:\\gone'],
    executionFailed: [],
    executionRejected: [],
    prepareRejected: [],
    result: {
      planId: 'p1',
      estimatedLogicalBytes: 100,
      movedToTrashBytes: 100,
      actuallyReclaimedBytes: 0,
      reclaimState: 'pending',
      recoveryMode: 'recycle-bin',
      moved: 1,
      skipped: 0,
      failed: 0,
      succeeded: ['C:\\gone'],
      errors: [],
      rejected: []
    },
    completedAt: Date.now()
  }
}

describe('post-cleanup rescan lifecycle', () => {
  it('formats rescanning state', () => {
    expect(formatPostCleanupRescanStatus('rescanning', baseSummary)).toContain('正在重新扫描')
    expect(formatPostCleanupRescanStatus('rescanning', baseSummary)).toContain(baseSummary)
  })

  it('formats rescan-completed with comparison detail', () => {
    const line = formatPostCleanupRescanStatus('rescan-completed', baseSummary, '重扫对比：1 项已消失')
    expect(line).toContain(baseSummary)
    expect(line).toContain('重扫对比')
  })

  it('formats rescan-failed without discarding cleanup summary', () => {
    const line = formatPostCleanupRescanStatus('rescan-failed', baseSummary, 'network error')
    expect(line).toContain(baseSummary)
    expect(line).toContain('自动复核失败')
    expect(line).toContain('请重新复核')
    expect(line).toContain('network error')
  })

  it('formats rescan-cancelled without discarding cleanup summary', () => {
    const line = formatPostCleanupRescanStatus('rescan-cancelled', baseSummary)
    expect(line).toContain(baseSummary)
    expect(line).toContain('自动复核已停止，请重新复核')
  })

  it('only applies comparison on rescan-completed', () => {
    expect(shouldApplyPostCleanupRescanComparison('rescan-completed')).toBe(true)
    expect(shouldApplyPostCleanupRescanComparison('rescan-failed')).toBe(false)
    expect(shouldApplyPostCleanupRescanComparison('rescan-cancelled')).toBe(false)
    expect(shouldApplyPostCleanupRescanComparison('rescanning')).toBe(false)
  })

  it('retains cleanup summary for all post-cleanup rescan states', () => {
    expect(shouldRetainCleanupSummary('rescanning')).toBe(true)
    expect(shouldRetainCleanupSummary('rescan-completed')).toBe(true)
    expect(shouldRetainCleanupSummary('rescan-failed')).toBe(true)
    expect(shouldRetainCleanupSummary('rescan-cancelled')).toBe(true)
    expect(shouldRetainCleanupSummary('idle')).toBe(false)
  })
})

describe('post-cleanup rescan controller lifecycle', () => {
  it('keeps cleanup summary visible during automatic rescan initialization', () => {
    let session = createPostCleanupRescanSession()
    session = beginPostCleanupRescanSession(session, {
      cleanupOutcomeSummary: baseSummary,
      pendingCleanupOutcome: sampleManifest(),
      drive: 'C:'
    })
    const status = resolveScanInitializationStatusText(session, '扫描中，发现的项目将实时列出…')
    expect(status).toContain(baseSummary)
    expect(status).toContain('正在重新扫描')
    expect(status).not.toBe('扫描中，发现的项目将实时列出…')
  })

  it('completes automatic rescan with comparison and consumes manifest', () => {
    let session = beginPostCleanupRescanSession(createPostCleanupRescanSession(), {
      cleanupOutcomeSummary: baseSummary,
      pendingCleanupOutcome: sampleManifest(),
      drive: 'C:'
    })
    session = applyPostCleanupRescanFinish(session, {
      cancelled: false,
      comparisonDetail: '重扫对比：1 项已消失'
    })
    expect(session.state).toBe('rescan-completed')
    expect(session.pendingCleanupOutcome).toBeNull()
    expect(session.cleanupOutcomeSummary).toContain('重扫对比')
  })

  it('keeps manifest after automatic rescan failure', () => {
    let session = beginPostCleanupRescanSession(createPostCleanupRescanSession(), {
      cleanupOutcomeSummary: baseSummary,
      pendingCleanupOutcome: sampleManifest(),
      drive: 'C:'
    })
    session = applyPostCleanupRescanFailure(session, 'network down')
    expect(session.state).toBe('rescan-failed')
    expect(session.pendingCleanupOutcome).not.toBeNull()
    expect(resolvePersistentCleanupStatusText(session)).toContain(baseSummary)
    expect(canRetryPostCleanupRescan(session)).toBe(true)
  })

  it('retry after failure re-enters rescanning without auto agent', () => {
    let session = applyPostCleanupRescanFailure(
      beginPostCleanupRescanSession(createPostCleanupRescanSession(), {
        cleanupOutcomeSummary: baseSummary,
        pendingCleanupOutcome: sampleManifest(),
        drive: 'D:'
      }),
      'timeout'
    )
    session = reducePostCleanupRescanSession(session, { type: 'retry-rescan' })
    expect(session.state).toBe('rescanning')
    expect(session.inFlight).toBe(true)
    expect(buildPostCleanupRescanScanOptions(session)).toEqual({
      drive: 'D:',
      confirmRescan: false,
      skipAutoAgent: true
    })
    expect(shouldSkipAutoAgentForScan(session)).toBe(true)
  })

  it('does not build comparison when automatic rescan is cancelled', () => {
    let session = beginPostCleanupRescanSession(createPostCleanupRescanSession(), {
      cleanupOutcomeSummary: baseSummary,
      pendingCleanupOutcome: sampleManifest(),
      drive: 'C:'
    })
    session = applyPostCleanupRescanFinish(session, { cancelled: true })
    expect(session.state).toBe('rescan-cancelled')
    expect(session.pendingCleanupOutcome).not.toBeNull()
    expect(shouldApplyPostCleanupRescanComparison(session.state)).toBe(false)
    expect(resolvePersistentCleanupStatusText(session)).toContain('自动复核已停止')
  })

  it('retry after cancellation can complete comparison', () => {
    let session = applyPostCleanupRescanFinish(
      beginPostCleanupRescanSession(createPostCleanupRescanSession(), {
        cleanupOutcomeSummary: baseSummary,
        pendingCleanupOutcome: sampleManifest(),
        drive: 'E:'
      }),
      { cancelled: true }
    )
    session = reducePostCleanupRescanSession(session, { type: 'retry-rescan' })
    session = applyPostCleanupRescanFinish(session, {
      cancelled: false,
      comparisonDetail: '重扫对比：1 项已消失'
    })
    expect(session.state).toBe('rescan-completed')
    expect(session.pendingCleanupOutcome).toBeNull()
  })

  it('ordinary scan abandons stale rescan context', () => {
    let session = applyPostCleanupRescanFailure(
      beginPostCleanupRescanSession(createPostCleanupRescanSession(), {
        cleanupOutcomeSummary: baseSummary,
        pendingCleanupOutcome: sampleManifest(),
        drive: 'C:'
      }),
      'x'
    )
    session = abandonPostCleanupRescanContext(session)
    expect(session.state).toBe('idle')
    expect(session.pendingCleanupOutcome).toBeNull()
    expect(canRetryPostCleanupRescan(session)).toBe(false)
  })

  it('blocks duplicate retry while rescan is in flight', () => {
    let session = reducePostCleanupRescanSession(
      applyPostCleanupRescanFailure(
        beginPostCleanupRescanSession(createPostCleanupRescanSession(), {
          cleanupOutcomeSummary: baseSummary,
          pendingCleanupOutcome: sampleManifest(),
          drive: 'C:'
        }),
        'busy'
      ),
      { type: 'retry-rescan' }
    )
    expect(session.inFlight).toBe(true)
    expect(canRetryPostCleanupRescan(session)).toBe(false)
    const secondRetry = reducePostCleanupRescanSession(session, { type: 'retry-rescan' })
    expect(secondRetry.state).toBe('rescanning')
    expect(secondRetry.inFlight).toBe(true)
  })
})

describe('scan preflight without mutating rescan context', () => {
  function failedSession() {
    return applyPostCleanupRescanFailure(
      beginPostCleanupRescanSession(createPostCleanupRescanSession(), {
        cleanupOutcomeSummary: baseSummary,
        pendingCleanupOutcome: sampleManifest(),
        drive: 'C:'
      }),
      'network'
    )
  }

  it('keeps context when first abandon confirmation is cancelled', () => {
    const session = failedSession()
    const plan = planScanPreflight(session, { isOrdinaryScan: true, hasSelectedItems: true })
    expect(plan.needsAbandonRescanConfirm).toBe(true)
    expect(session.pendingCleanupOutcome).not.toBeNull()
    expect(canRetryPostCleanupRescan(session)).toBe(true)
  })

  it('keeps context when clear-selection confirmation would be cancelled after abandon accepted', () => {
    const session = failedSession()
    const plan = planScanPreflight(session, { isOrdinaryScan: true, hasSelectedItems: true })
    expect(plan.combinedConfirm).toBe(true)
    expect(session.pendingCleanupOutcome).not.toBeNull()
  })

  it('clears context only after commitScanPreflight for ordinary scan', () => {
    const session = failedSession()
    const committed = commitScanPreflight(session, { isOrdinaryScan: true })
    expect(committed.session.pendingCleanupOutcome).toBeNull()
    expect(committed.session.state).toBe('idle')
    expect(canRetryPostCleanupRescan(session)).toBe(true)
    expect(canRetryPostCleanupRescan(committed.session)).toBe(false)
  })

  it('clears context for ordinary scan without selected items after commit', () => {
    const session = failedSession()
    const plan = planScanPreflight(session, { isOrdinaryScan: true, hasSelectedItems: false })
    expect(plan.needsClearSelectionConfirm).toBe(false)
    expect(plan.needsAbandonRescanConfirm).toBe(true)
    const committed = commitScanPreflight(session, { isOrdinaryScan: true })
    expect(committed.session.pendingCleanupOutcome).toBeNull()
  })

  it('does not clear manifest on rescan retry commit path', () => {
    const session = reducePostCleanupRescanSession(failedSession(), { type: 'retry-rescan' })
    const committed = commitScanPreflight(session, { isOrdinaryScan: false, skipAutoAgentOption: true })
    expect(committed.session.pendingCleanupOutcome).not.toBeNull()
    expect(committed.skipAutoAgent).toBe(true)
  })

  it('still allows retry after preflight cancellation because session was not committed', () => {
    const session = failedSession()
    expect(planScanPreflight(session, { isOrdinaryScan: true, hasSelectedItems: true }).needsAbandonRescanConfirm).toBe(
      true
    )
    expect(canRetryPostCleanupRescan(session)).toBe(true)
  })
})

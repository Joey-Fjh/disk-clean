import type { ScanProgress, ScanRequest, ScanResult, ScanItem } from '../../shared/types'
import { computeDeletableTotalSize } from '../../shared/scan-stats'
import { runRuleScan } from './rule-scanner'
import { runDiskAnalysis } from './disk-analyzer'
import { upsertScanItems } from '../../shared/scan-item-accumulator'
import { beginScanSession, endScanSession, isScanCancelled } from './scan-controller'
import { createScanSession } from '../scan/scan-session-store'
import { getAllRulesWithMeta } from '../rules'

type ProgressCallback = (progress: ScanProgress) => void
type ItemsCallback = (items: ScanItem[]) => void

function getRulesVersion(): string {
  return getAllRulesWithMeta()
    .map((r) => `${r.id}:${r.enabled ? 1 : 0}`)
    .join('|')
}

async function runLegacyScan(
  mode: 'quick' | 'full',
  drive: string,
  onProgress?: ProgressCallback,
  onItems?: ItemsCallback
): Promise<Pick<ScanResult, 'items' | 'errors' | 'cancelled'>> {
  if (mode === 'full') {
    const analysis = await runDiskAnalysis(drive, onProgress, onItems)
    return {
      items: analysis.items,
      errors: analysis.errors,
      cancelled: analysis.cancelled ?? false
    }
  }

  const ruleScan = await runRuleScan(drive, onProgress, onItems, mode)
  return {
    items: ruleScan.items,
    errors: ruleScan.errors,
    cancelled: ruleScan.cancelled
  }
}

async function runCombinedScan(
  drive: string,
  onProgress?: ProgressCallback,
  onItems?: ItemsCallback
): Promise<Pick<ScanResult, 'items' | 'errors' | 'cancelled'>> {
  let mergedItems: ScanItem[] = []
  const errors: ScanResult['errors'] = []
  let cancelled = false

  const emitMerged = (batch: ScanItem[]): void => {
    if (batch.length === 0) return
    const { items, upserted } = upsertScanItems(mergedItems, batch)
    mergedItems = items
    if (upserted.length > 0) {
      onItems?.(upserted)
    }
  }

  const diskResult = await runDiskAnalysis(
    drive,
    (progress) => {
      onProgress?.({ ...progress, mode: 'combined', phase: 'space-discovery' })
    },
    (batch) => {
      emitMerged(batch)
    }
  )
  errors.push(...diskResult.errors)
  cancelled = diskResult.cancelled ?? false
  emitMerged(diskResult.items)

  if (!cancelled && !isScanCancelled()) {
    const ruleResult = await runRuleScan(
      drive,
      (progress) => {
        onProgress?.({ ...progress, mode: 'combined', phase: 'rule-identification' })
      },
      (batch) => {
        emitMerged(batch)
      },
      'combined'
    )
    errors.push(...ruleResult.errors)
    cancelled = cancelled || ruleResult.cancelled
    emitMerged(ruleResult.items)
  }

  return { items: mergedItems, errors, cancelled }
}

export async function runScan(
  request: ScanRequest = {},
  onProgress?: ProgressCallback,
  onItems?: ItemsCallback
): Promise<ScanResult> {
  beginScanSession()
  const drive = request.drive ?? 'all'
  const mode = request.mode ?? 'combined'

  try {
    const result =
      mode === 'combined'
        ? await runCombinedScan(drive, onProgress, onItems)
        : await runLegacyScan(mode, drive, onProgress, onItems)

    const session = createScanSession(drive, mode, getRulesVersion(), result.items)

    return {
      sessionId: session.sessionId,
      drive,
      mode,
      items: result.items,
      errors: result.errors,
      cancelled: result.cancelled,
      totalSize: computeDeletableTotalSize(result.items),
      scannedAt: new Date().toISOString()
    }
  } finally {
    endScanSession()
  }
}

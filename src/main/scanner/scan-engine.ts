import type { ScanProgress, ScanRequest, ScanResult, ScanItem } from '../../shared/types'
import { runRuleScan } from './rule-scanner'
import { runDiskAnalysis } from './disk-analyzer'
import { beginScanSession, endScanSession } from './scan-controller'
import { createScanSession } from '../scan/scan-session-store'
import { getAllRulesWithMeta } from '../rules'

type ProgressCallback = (progress: ScanProgress) => void
type ItemsCallback = (items: ScanItem[]) => void

function getRulesVersion(): string {
  return getAllRulesWithMeta()
    .map((r) => `${r.id}:${r.enabled ? 1 : 0}`)
    .join('|')
}

export async function runScan(
  request: ScanRequest = {},
  onProgress?: ProgressCallback,
  onItems?: ItemsCallback
): Promise<ScanResult> {
  beginScanSession()
  const drive = request.drive ?? 'all'
  const mode = request.mode ?? 'quick'

  try {
    let items: ScanItem[] = []
    let errors: ScanResult['errors'] = []
    let cancelled = false

    if (mode === 'full') {
      const analysis = await runDiskAnalysis(drive, onProgress)
      items = analysis.items
      errors = analysis.errors
      cancelled = analysis.cancelled ?? false
    } else {
      const ruleScan = await runRuleScan(drive, onProgress, onItems, mode)
      items = ruleScan.items
      errors = ruleScan.errors
      cancelled = ruleScan.cancelled
    }

    const session = createScanSession(drive, mode, getRulesVersion(), items)

    return {
      sessionId: session.sessionId,
      drive,
      mode,
      items,
      errors,
      cancelled,
      totalSize: items.reduce((sum, item) => sum + item.size, 0),
      scannedAt: new Date().toISOString()
    }
  } finally {
    endScanSession()
  }
}

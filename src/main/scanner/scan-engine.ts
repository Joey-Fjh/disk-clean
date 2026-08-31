import type { ScanProgress, ScanRequest, ScanResult, ScanItem } from '../../shared/types'
import { computeDeletableTotalSize } from '../../shared/scan-stats'
import { runRuleScan } from './rule-scanner'
import { runDiskAnalysis } from './disk-analyzer'
import { upsertScanItems } from '../../shared/scan-item-accumulator'
import { beginScanSession, endScanSession, isScanCancelled } from './scan-controller'
import { createScanSession } from '../scan/scan-session-store'
import { markAgentScanStarting, notifyNewScanSession } from '../agent/agent-service'
import {
  markRuleDraftScanStarting,
  notifyRuleDraftNewScanSession
} from '../rules/rule-draft-agent-service'
import { enrichItemsWithDetectionHeuristics } from '../rules/heuristic-enricher'
import { enrichItemsWithUserExperiences } from '../experience/experience-enricher'
import { getEnabledUserExperiences } from '../experience/user-experience-service'
import { clearSessionMeasureCache } from './measure-size'
import { getAllRulesWithMeta, getProtectedPaths } from '../rules'
import { normalizeCandidate } from '../../shared/candidate-model'
import { finalizeLocalScanItem } from '../../shared/candidate-judgment'
import { isProtectedPath } from '../../shared/path-utils'

type ProgressCallback = (progress: ScanProgress) => void
type ItemsCallback = (items: ScanItem[]) => void

function getRulesVersion(): string {
  return getAllRulesWithMeta()
    .map((r) => `${r.id}:${r.enabled ? 1 : 0}`)
    .join('|')
}

export function finalizeLocalScanItems(items: ScanItem[], protectedPaths: string[]): ScanItem[] {
  return items.map((item) => {
    const normalized = normalizeCandidate(item)
    const protectedPath = isProtectedPath(normalized.path, protectedPaths)
    if (protectedPath) {
      return normalizeCandidate(finalizeLocalScanItem(normalized, true))
    }
    if (normalized.judgment.status !== 'identifying' && normalized.judgment.status !== 'pending') {
      return normalized
    }
    return normalizeCandidate(finalizeLocalScanItem(normalized, false))
  })
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
  clearSessionMeasureCache()
  beginScanSession()
  markAgentScanStarting()
  markRuleDraftScanStarting()
  const drive = request.drive ?? 'all'
  const mode = request.mode ?? 'combined'

  try {
    const result =
      mode === 'combined'
        ? await runCombinedScan(drive, onProgress, onItems)
        : await runLegacyScan(mode, drive, onProgress, onItems)

    const enrichedItems = finalizeLocalScanItems(
      enrichItemsWithUserExperiences(
        enrichItemsWithDetectionHeuristics(result.items),
        getEnabledUserExperiences()
      ),
      getProtectedPaths()
    )
    const session = createScanSession(drive, mode, getRulesVersion(), enrichedItems)
    notifyNewScanSession(session.sessionId)
    notifyRuleDraftNewScanSession(session.sessionId)

    return {
      sessionId: session.sessionId,
      drive,
      mode,
      items: enrichedItems,
      errors: result.errors,
      cancelled: result.cancelled,
      totalSize: computeDeletableTotalSize(enrichedItems),
      scannedAt: new Date().toISOString()
    }
  } finally {
    endScanSession()
  }
}

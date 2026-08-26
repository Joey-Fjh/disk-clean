import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanItem } from '../src/shared/types'
import { readFileSync } from 'fs'
import { join } from 'path'

const runDiskAnalysis = vi.fn()
const runRuleScan = vi.fn()
const getAllRulesWithMeta = vi.fn(() => [])

vi.mock('../src/main/scanner/disk-analyzer', () => ({
  runDiskAnalysis: (...args: unknown[]) => runDiskAnalysis(...args)
}))

vi.mock('../src/main/scanner/rule-scanner', () => ({
  runRuleScan: (...args: unknown[]) => runRuleScan(...args)
}))

vi.mock('../src/main/rules', () => ({
  getAllRulesWithMeta: () => getAllRulesWithMeta(),
  getProtectedPaths: () => []
}))

import { runScan } from '../src/main/scanner/scan-engine'
import { cancelScanSession } from '../src/main/scanner/scan-controller'
import { getScanSession } from '../src/main/scan/scan-session-store'
import { accumulateScanItemBatches } from '../src/shared/scan-item-accumulator'
import { computeDeletableTotalSize } from '../src/shared/scan-stats'

function scanItem(overrides: Partial<ScanItem> & Pick<ScanItem, 'id' | 'path' | 'source'>): ScanItem {
  return {
    ruleId: overrides.ruleId ?? 'rule-a',
    ruleName: overrides.ruleName ?? 'Rule A',
    category: overrides.category ?? (overrides.deletable === false ? 'dangerous' : 'safe'),
    contentType: overrides.contentType ?? 'app-cache',
    drive: overrides.drive ?? 'C:',
    path: overrides.path,
    size: overrides.size ?? 100,
    sizeIsEstimate: overrides.sizeIsEstimate ?? true,
    snapshotComplete: overrides.snapshotComplete ?? true,
    entryKind: overrides.entryKind ?? 'directory',
    deletable: overrides.deletable ?? overrides.source === 'rule',
    autoSelect: overrides.autoSelect ?? false,
    source: overrides.source,
    id: overrides.id,
    reason: overrides.reason
  }
}

describe('unified scan orchestration', () => {
  beforeEach(() => {
    runDiskAnalysis.mockReset()
    runRuleScan.mockReset()
    getAllRulesWithMeta.mockReset()
    getAllRulesWithMeta.mockReturnValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('runs disk analysis and rule scan in one combined session', async () => {
    runDiskAnalysis.mockResolvedValue({
      items: [
        scanItem({
          id: 'analyzer:C:\\Users',
          source: 'analyzer',
          path: 'C:\\Users',
          deletable: false,
          category: 'dangerous'
        })
      ],
      errors: []
    })
    runRuleScan.mockResolvedValue({
      items: [
        scanItem({
          id: 'rule-a:C:\\Temp\\cache',
          source: 'rule',
          path: 'C:\\Temp\\cache',
          deletable: true
        })
      ],
      errors: [],
      cancelled: false
    })

    const result = await runScan({ drive: 'C:' })

    expect(runDiskAnalysis).toHaveBeenCalledWith('C:', expect.any(Function), expect.any(Function))
    expect(runRuleScan).toHaveBeenCalledWith('C:', expect.any(Function), expect.any(Function), 'combined')
    expect(result.mode).toBe('combined')
    expect(result.items).toHaveLength(2)
    expect(getScanSession(result.sessionId)?.candidates.size).toBe(2)
  })

  it('passes drive filter to both internal stages for single-drive scans', async () => {
    runDiskAnalysis.mockResolvedValue({ items: [], errors: [] })
    runRuleScan.mockResolvedValue({ items: [], errors: [], cancelled: false })

    await runScan({ drive: 'D:' })

    expect(runDiskAnalysis.mock.calls[0][0]).toBe('D:')
    expect(runRuleScan.mock.calls[0][0]).toBe('D:')
  })

  it('runs both stages for all-drive scans', async () => {
    runDiskAnalysis.mockResolvedValue({ items: [], errors: [] })
    runRuleScan.mockResolvedValue({ items: [], errors: [], cancelled: false })

    await runScan({ drive: 'all' })

    expect(runDiskAnalysis.mock.calls[0][0]).toBe('all')
    expect(runRuleScan.mock.calls[0][0]).toBe('all')
  })

  it('skips rule scan when space discovery is cancelled', async () => {
    runDiskAnalysis.mockImplementation(async () => {
      cancelScanSession()
      return {
        items: [
          scanItem({
            id: 'analyzer:C:\\',
            source: 'analyzer',
            path: 'C:\\',
            deletable: false
          })
        ],
        errors: [],
        cancelled: true
      }
    })
    runRuleScan.mockResolvedValue({ items: [], errors: [], cancelled: false })

    const result = await runScan({ drive: 'C:' })

    expect(runRuleScan).not.toHaveBeenCalled()
    expect(result.cancelled).toBe(true)
    expect(result.items).toHaveLength(1)
  })

  it('skips rule scan when diskResult.cancelled is true without global abort', async () => {
    runDiskAnalysis.mockResolvedValue({
      items: [
        scanItem({
          id: 'analyzer:C:\\Users',
          source: 'analyzer',
          path: 'C:\\Users',
          deletable: false
        })
      ],
      errors: [],
      cancelled: true
    })
    runRuleScan.mockResolvedValue({ items: [], errors: [], cancelled: false })

    const result = await runScan({ drive: 'C:' })

    expect(runRuleScan).not.toHaveBeenCalled()
    expect(result.cancelled).toBe(true)
    expect(result.items).toHaveLength(1)
  })

  it('pushes upsert-only batches through onItems without live duplication', async () => {
    const analyzerA = scanItem({
      id: 'analyzer:C:\\A',
      source: 'analyzer',
      path: 'C:\\A',
      deletable: false
    })
    const analyzerB = scanItem({
      id: 'analyzer:C:\\B',
      source: 'analyzer',
      path: 'C:\\B',
      deletable: false
    })
    const ruleA = scanItem({
      id: 'rule-a:C:\\A',
      source: 'rule',
      path: 'C:\\A',
      deletable: true,
      size: 42
    })

    runDiskAnalysis.mockImplementation(async (_drive, _onProgress, onItems) => {
      onItems?.([analyzerA])
      onItems?.([analyzerB])
      return { items: [analyzerA, analyzerB], errors: [] }
    })
    runRuleScan.mockImplementation(async (_drive, _onProgress, onItems) => {
      onItems?.([ruleA])
      return { items: [ruleA], errors: [], cancelled: false }
    })

    const upsertBatches: ScanItem[][] = []
    const result = await runScan({ drive: 'C:' }, undefined, (batch) => {
      upsertBatches.push(batch)
    })

    const live = accumulateScanItemBatches(upsertBatches)

    expect(live).toHaveLength(2)
    const mergedA = live.find((entry) => entry.path === 'C:\\A')
    expect(mergedA?.source).toBe('rule')
    expect(mergedA?.discoverySources).toEqual(expect.arrayContaining(['space-scan', 'rule']))
    expect(live.find((entry) => entry.path === 'C:\\B')?.judgment?.status).toBe('identifying')
    expect(result.items.map((entry) => entry.path).sort()).toEqual(live.map((entry) => entry.path).sort())
    expect(computeDeletableTotalSize(live)).toBe(computeDeletableTotalSize(result.items))
  })

  it('keeps partial results when rule scan is cancelled', async () => {
    runDiskAnalysis.mockResolvedValue({
      items: [
        scanItem({
          id: 'analyzer:C:\\Users',
          source: 'analyzer',
          path: 'C:\\Users',
          deletable: false
        })
      ],
      errors: []
    })
    runRuleScan.mockResolvedValue({
      items: [
        scanItem({
          id: 'rule-a:C:\\Temp\\a',
          source: 'rule',
          path: 'C:\\Temp\\a',
          deletable: true
        })
      ],
      errors: [],
      cancelled: true
    })

    const result = await runScan({ drive: 'C:' })

    expect(result.items).toHaveLength(2)
    expect(result.cancelled).toBe(true)
  })

  it('deduplicates identical paths with rule results winning in final session', async () => {
    const sharedPath = 'C:\\Temp\\cache'
    runDiskAnalysis.mockResolvedValue({
      items: [
        scanItem({
          id: `analyzer:${sharedPath}`,
          source: 'analyzer',
          path: sharedPath,
          deletable: false,
          category: 'dangerous',
          size: 900
        })
      ],
      errors: []
    })
    runRuleScan.mockResolvedValue({
      items: [
        scanItem({
          id: `rule-a:${sharedPath}`,
          source: 'rule',
          path: sharedPath,
          deletable: true,
          category: 'safe',
          size: 880
        })
      ],
      errors: [],
      cancelled: false
    })

    const result = await runScan({ drive: 'C:' })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].source).toBe('rule')
    expect(result.items[0].deletable).toBe(true)
    expect(result.items[0].discoverySources).toEqual(expect.arrayContaining(['space-scan', 'rule']))
    expect(result.totalSize).toBe(880)
  })

  it('reports deletable total without counting analyzer-only occupancy', async () => {
    runDiskAnalysis.mockResolvedValue({
      items: [
        scanItem({
          id: 'analyzer:C:\\Users',
          source: 'analyzer',
          path: 'C:\\Users',
          size: 50_000,
          deletable: false
        })
      ],
      errors: []
    })
    runRuleScan.mockResolvedValue({
      items: [
        scanItem({
          id: 'rule-a:C:\\Temp\\a',
          source: 'rule',
          path: 'C:\\Temp\\a',
          size: 120,
          deletable: true
        })
      ],
      errors: [],
      cancelled: false
    })

    const result = await runScan({ drive: 'C:' })

    expect(result.totalSize).toBe(120)
  })
})

describe('renderer scan UI', () => {
  it('does not expose a scan mode selector in the clean panel', () => {
    const html = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf-8')
    expect(html).not.toContain('id="mode-select"')
    expect(html).not.toContain('第 0/0 条规则')
    expect(html).not.toContain('按规则列出')
    expect(html).toContain('扫描磁盘空间、收集本地证据，并形成待判断的清理候选项')
    expect(html).not.toContain('仅分析')
  })
})

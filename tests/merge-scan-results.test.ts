import { describe, expect, it } from 'vitest'
import { normalizeScanPath } from '../src/shared/scan-path'
import {
  accumulateScanItemBatches,
  upsertScanItems
} from '../src/shared/scan-item-accumulator'
import { mergeScanItems } from '../src/main/scanner/merge-scan-results'
import { computeDeletableTotalSize } from '../src/shared/scan-stats'
import type { ScanItem } from '../src/shared/types'

function item(overrides: Partial<ScanItem> & Pick<ScanItem, 'path' | 'source'>): ScanItem {
  return {
    id: overrides.id ?? `${overrides.source}:${overrides.path}`,
    ruleId: overrides.ruleId ?? (overrides.source === 'rule' ? 'rule-a' : '__analyzer__'),
    ruleName: overrides.ruleName ?? (overrides.source === 'rule' ? 'Rule A' : 'Large Dir'),
    category: overrides.category ?? (overrides.source === 'rule' ? 'safe' : 'dangerous'),
    contentType: overrides.contentType ?? (overrides.source === 'rule' ? 'app-cache' : 'large-dir'),
    drive: overrides.drive ?? 'C:',
    path: overrides.path,
    size: overrides.size ?? 100,
    sizeIsEstimate: overrides.sizeIsEstimate ?? true,
    snapshotComplete: overrides.snapshotComplete ?? true,
    entryKind: overrides.entryKind ?? 'directory',
    deletable: overrides.deletable ?? overrides.source === 'rule',
    autoSelect: overrides.autoSelect ?? false,
    source: overrides.source,
    reason: overrides.reason,
    impact: overrides.impact
  }
}

describe('normalizeScanPath', () => {
  it('normalizes slashes, repeated trailing separators, and case on Windows', () => {
    expect(normalizeScanPath('C:/Temp/cache/')).toBe('c:\\temp\\cache')
    expect(normalizeScanPath('C:\\TEMP\\cache')).toBe('c:\\temp\\cache')
    expect(normalizeScanPath('C:\\Temp\\\\')).toBe('c:\\temp')
    expect(normalizeScanPath('C:/Temp///')).toBe('c:\\temp')
    expect(normalizeScanPath('C:\\')).toBe('c:\\')
  })

  it('preserves UNC share roots when trimming trailing separators', () => {
    expect(normalizeScanPath('\\\\server\\share\\')).toBe('\\\\server\\share')
    expect(normalizeScanPath('//server/share///')).toBe('\\\\server\\share')
  })
})

describe('upsertScanItems / live accumulation', () => {
  it('accumulates analyzer A then B as two distinct live items', () => {
    const a = item({ source: 'analyzer', path: 'C:\\A', deletable: false })
    const b = item({ source: 'analyzer', path: 'C:\\B', deletable: false })

    const live = accumulateScanItemBatches([[a], [b]])

    expect(live).toHaveLength(2)
    expect(live.map((entry) => entry.path).sort()).toEqual(['C:\\A', 'C:\\B'])
  })

  it('does not duplicate when phase end re-sends the same analyzer items', () => {
    const a = item({ source: 'analyzer', path: 'C:\\A', deletable: false })
    const b = item({ source: 'analyzer', path: 'C:\\B', deletable: false })

    const live = accumulateScanItemBatches([[a], [b], [a, b]])

    expect(live).toHaveLength(2)
  })

  it('merges analyzer path with rule item preserving both evidence sources', () => {
    const analyzer = item({
      source: 'analyzer',
      path: 'C:\\Temp\\cache',
      deletable: false,
      size: 900
    })
    const rule = item({
      source: 'rule',
      path: 'C:\\Temp\\cache',
      deletable: true,
      size: 880
    })

    const live = accumulateScanItemBatches([[analyzer], [rule]])

    expect(live).toHaveLength(1)
    expect(live[0].discoverySources).toEqual(expect.arrayContaining(['space-scan', 'rule']))
    expect(live[0].judgment?.status).toBe('suggested')
    expect(live[0].deletable).toBe(true)
    expect(live[0].size).toBe(880)
    expect(live[0].occupancyObservation?.size).toBe(900)
  })

  it('keeps live totals aligned with final merged result semantics', () => {
    const analyzer = item({
      source: 'analyzer',
      path: 'C:\\Users',
      size: 50_000,
      deletable: false
    })
    const ruleA = item({ source: 'rule', path: 'C:\\Temp\\a', size: 100, deletable: true })
    const ruleB = item({ source: 'rule', path: 'C:\\Temp\\b', size: 50, deletable: true })

    const batches = [[analyzer], [ruleA], [ruleB]]
    const live = accumulateScanItemBatches(batches)
    const final = mergeScanItems([], mergeScanItems(mergeScanItems([], [analyzer]), mergeScanItems([], [ruleA, ruleB])))

    expect(live.map((entry) => normalizeScanPath(entry.path)).sort()).toEqual(
      final.map((entry) => normalizeScanPath(entry.path)).sort()
    )
    expect(live).toHaveLength(final.length)
    expect(computeDeletableTotalSize(live)).toBe(computeDeletableTotalSize(final))
  })

  it('is idempotent when the same batch is delivered twice', () => {
    const a = item({ source: 'analyzer', path: 'C:\\A', deletable: false })
    const once = upsertScanItems([], [a])
    const twice = upsertScanItems(once.items, [a])

    expect(once.upserted).toHaveLength(1)
    expect(twice.upserted).toHaveLength(0)
    expect(twice.items).toHaveLength(1)
  })

  it('treats path variants with identical semantics as the same item', () => {
    const base = item({ source: 'analyzer', path: 'C:\\Temp\\cache', deletable: false })
    const variant = { ...base, path: 'c:/temp/cache/' }

    const result = upsertScanItems([base], [variant])

    expect(result.upserted).toHaveLength(0)
    expect(result.items).toHaveLength(1)
  })

  it('upserts when only category changes', () => {
    const original = item({ source: 'rule', path: 'C:\\Temp\\a', category: 'safe' })
    const updated = { ...original, category: 'recommended' as const }

    const result = upsertScanItems([original], [updated])

    expect(result.upserted).toHaveLength(1)
    expect(result.items[0].category).toBe('recommended')
  })

  it('upserts when only reason or impact changes', () => {
    const original = item({
      source: 'rule',
      path: 'C:\\Temp\\a',
      reason: '旧说明',
      impact: '旧影响'
    })
    const updated = { ...original, reason: '新说明', impact: '新影响' }

    const result = upsertScanItems([original], [updated])

    expect(result.upserted).toHaveLength(1)
    expect(result.items[0].reason).toBe('新说明')
    expect(result.items[0].impact).toBe('新影响')
  })

  it('upserts when only mtimeMs or snapshotComplete changes', () => {
    const original = item({
      source: 'rule',
      path: 'C:\\Temp\\a',
      mtimeMs: 1000,
      snapshotComplete: true
    })
    const updated = { ...original, mtimeMs: 2000, snapshotComplete: false }

    const result = upsertScanItems([original], [updated])

    expect(result.upserted).toHaveLength(1)
    expect(result.items[0].mtimeMs).toBe(2000)
    expect(result.items[0].snapshotComplete).toBe(false)
  })
})

describe('mergeScanItems', () => {
  it('merges rule scan result with space scan for the exact same path', () => {
    const analyzer = item({
      source: 'analyzer',
      path: 'C:\\Users\\admin\\AppData\\Local\\Temp\\cache',
      size: 500,
      deletable: false,
      category: 'dangerous'
    })
    const rule = item({
      source: 'rule',
      path: 'C:\\Users\\admin\\AppData\\Local\\Temp\\cache',
      size: 480,
      deletable: true,
      category: 'safe',
      reason: '临时缓存'
    })

    const merged = mergeScanItems([analyzer], [rule])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('rule')
    expect(merged[0].deletable).toBe(true)
    expect(merged[0].size).toBe(480)
    expect(merged[0].discoverySources).toEqual(expect.arrayContaining(['space-scan', 'rule']))
    expect(merged[0].judgment?.status).toBe('suggested')
    expect(merged[0].occupancyObservation?.size).toBe(500)
  })

  it('keeps parent and child paths separate', () => {
    const parent = item({
      source: 'analyzer',
      path: 'C:\\Users\\admin\\AppData',
      size: 10_000,
      deletable: false
    })
    const child = item({
      source: 'rule',
      path: 'C:\\Users\\admin\\AppData\\Local\\Temp',
      size: 200,
      deletable: true
    })

    const merged = mergeScanItems([parent], [child])
    expect(merged).toHaveLength(2)
  })

  it('keeps analyzer item when rule item does not overlap path', () => {
    const analyzer = item({ source: 'analyzer', path: 'D:\\Data', deletable: false })
    const rule = item({ source: 'rule', path: 'C:\\Temp\\file.tmp', deletable: true })

    const merged = mergeScanItems([analyzer], [rule])
    expect(merged).toHaveLength(2)
  })
})

describe('computeDeletableTotalSize', () => {
  it('excludes analyzer-only space occupancy from deletable total', () => {
    const items = [
      item({ source: 'analyzer', path: 'C:\\Users', size: 50_000, deletable: false }),
      item({ source: 'rule', path: 'C:\\Temp\\a', size: 100, deletable: true }),
      item({ source: 'rule', path: 'C:\\Temp\\b', size: 50, deletable: true, category: 'recommended' })
    ]

    expect(computeDeletableTotalSize(items)).toBe(150)
  })
})

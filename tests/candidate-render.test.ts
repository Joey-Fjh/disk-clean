// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mapRuleScanItem, mapSpaceScanItem, mergeScanCandidates } from '../src/shared/candidate-model'
import { buildEvidenceItems, buildScanItemRenderInput } from '../src/renderer/candidate-render'
import { createScanItemElement } from '../src/renderer/safe-render'
import type { ScanItem } from '../src/shared/types'

const MB = 1024 * 1024

function legacyAnalyzer(overrides: Partial<ScanItem> & Pick<ScanItem, 'path'>): ScanItem {
  return mapSpaceScanItem({
    id: `analyzer:${overrides.path}`,
    ruleId: '__analyzer__',
    ruleName: 'Large Dir',
    category: 'dangerous',
    contentType: 'large-dir',
    drive: 'C:',
    path: overrides.path,
    size: overrides.size ?? 100,
    sizeIsEstimate: true,
    snapshotComplete: overrides.snapshotComplete ?? true,
    sizePartial: overrides.sizePartial,
    entryKind: 'directory',
    deletable: false,
    autoSelect: false,
    source: 'analyzer',
    reason: overrides.reason ?? '磁盘空间占用分析（逻辑大小估算）',
    discoverySources: ['space-scan'],
    evidence: [],
    judgment: { status: 'pending', source: 'none', confidence: 'unknown', basis: [] },
    selection: { selectable: false },
    suggestedAction: 'none'
  })
}

function legacyRule(
  overrides: Partial<ScanItem> & Pick<ScanItem, 'path' | 'category'>
): ScanItem {
  const category = overrides.category
  return mapRuleScanItem({
    id: `rule-a:${overrides.path}`,
    ruleId: 'rule-a',
    ruleName: 'Rule A',
    category,
    contentType: 'app-cache',
    drive: 'C:',
    path: overrides.path,
    size: overrides.size ?? 100,
    sizeIsEstimate: true,
    snapshotComplete: overrides.snapshotComplete ?? true,
    entryKind: 'directory',
    deletable: overrides.deletable ?? category !== 'dangerous',
    autoSelect: false,
    source: 'rule',
    reason: overrides.reason ?? '临时缓存',
    discoverySources: ['rule'],
    evidence: [],
    judgment: { status: 'pending', source: 'none', confidence: 'unknown', basis: [] },
    selection: { selectable: false },
    suggestedAction: 'none',
    ...overrides
  })
}

describe('buildScanItemRenderInput', () => {
  it('includes execution size 880 MB and occupancy 900 MB for merged candidates', () => {
    const merged = mergeScanCandidates(
      legacyAnalyzer({
        path: 'C:\\Temp\\cache',
        size: 900 * MB,
        snapshotComplete: false,
        sizePartial: true
      }),
      legacyRule({
        path: 'C:\\Temp\\cache',
        category: 'safe',
        deletable: true,
        size: 880 * MB,
        snapshotComplete: true
      })
    )

    const input = buildScanItemRenderInput(merged, { contentTypeLabel: '应用缓存' })

    expect(input.executionSizeBytes).toBe(880 * MB)
    expect(input.occupancySizeBytes).toBe(900 * MB)
    expect(input.sizeCaption).toBe('可清理逻辑大小估算')
    expect(input.sizeLabel).toContain('880')
  })

  it('includes both space-scan and rule evidence for merged candidates', () => {
    const merged = mergeScanCandidates(
      legacyAnalyzer({ path: 'C:\\Temp\\cache', size: 900 * MB, snapshotComplete: false, sizePartial: true }),
      legacyRule({ path: 'C:\\Temp\\cache', category: 'safe', deletable: true, size: 880 * MB })
    )

    const input = buildScanItemRenderInput(merged, { contentTypeLabel: '应用缓存' })
    const sources = input.evidenceItems?.map((e) => e.source) ?? []

    expect(sources).toContain('space-scan')
    expect(sources).toContain('rule')
    expect(input.evidenceItems?.find((e) => e.source === 'space-scan')?.summary).toContain('900')
    expect(input.evidenceItems?.find((e) => e.source === 'space-scan')?.summary).toContain('不完整')
  })

  it('shows space discovery source for pure pending items', () => {
    const pending = legacyAnalyzer({ path: 'C:\\Users', size: 50 * MB })

    const input = buildScanItemRenderInput(pending, { contentTypeLabel: '大型目录' })

    expect(input.typeLabel).toContain('空间发现')
    expect(input.sizeCaption).toBe('空间占用估算')
    expect(input.evidenceItems?.some((e) => e.source === 'space-scan')).toBe(true)
    expect(input.evidenceItems?.[0]?.sourceLabel).toBe('空间发现')
  })

  it('does not expose agent evidence when absent from data', () => {
    const merged = mergeScanCandidates(
      legacyAnalyzer({ path: 'C:\\Temp\\cache', size: 900 * MB }),
      legacyRule({ path: 'C:\\Temp\\cache', category: 'safe', deletable: true, size: 880 * MB })
    )

    const items = buildEvidenceItems(merged, merged)
    expect(items.some((e) => e.source === 'agent')).toBe(false)
  })

  it('includes agent evidence when present on candidate', () => {
    const rule = legacyRule({ path: 'C:\\Temp\\cache', category: 'safe', deletable: true })
    const withAgent: ScanItem = {
      ...rule,
      discoverySources: ['rule', 'agent'],
      evidence: [
        { source: 'rule', summary: '临时缓存' },
        { source: 'agent', summary: '模型判断依据' }
      ]
    }

    const items = buildEvidenceItems(withAgent, withAgent)
    const agent = items.find((e) => e.source === 'agent')

    expect(agent).toBeDefined()
    expect(agent?.sourceLabel).toBe('Agent')
    expect(agent?.summary).toBe('模型判断依据')
  })
})

describe('createScanItemElement evidence rendering', () => {
  it('renders evidence summary as plain text when it contains html', () => {
    const payload = '<script>alert(1)</script>'
    const li = createScanItemElement({
      fileName: 'cache',
      path: 'C:\\Temp\\cache',
      typeLabel: 'test',
      sizeLabel: '880 MB',
      evidenceItems: [
        { source: 'rule', sourceLabel: '规则', summary: payload }
      ]
    })

    const summary = li.querySelector('.item-evidence-summary')
    expect(summary?.textContent).toBe(payload)
    expect(summary?.innerHTML).not.toContain('<script>')
    expect(li.querySelector('script')).toBeNull()
  })

  it('renders merged execution and occupancy evidence in the dom', () => {
    const merged = mergeScanCandidates(
      legacyAnalyzer({ path: 'C:\\Temp\\cache', size: 900 * MB, sizePartial: true, snapshotComplete: false }),
      legacyRule({ path: 'C:\\Temp\\cache', category: 'safe', deletable: true, size: 880 * MB })
    )
    const input = buildScanItemRenderInput(merged, { contentTypeLabel: '应用缓存' })
    const li = createScanItemElement(input)

    expect(li.querySelector('.item-size-caption')?.textContent).toBe('可清理逻辑大小估算')
    expect(li.querySelector('.item-size-value')?.textContent).toContain('880')
    expect(li.textContent).toContain('空间观察')
    expect(li.textContent).toContain('900')
    expect(li.textContent).toContain('规则')
    expect(li.textContent).toContain('不完整')
  })

  it('does not disable checkbox based on evidence rendering', () => {
    const merged = mergeScanCandidates(
      legacyAnalyzer({ path: 'C:\\Temp\\cache', size: 900 * MB }),
      legacyRule({ path: 'C:\\Temp\\cache', category: 'safe', deletable: true, size: 880 * MB })
    )
    const li = createScanItemElement(
      buildScanItemRenderInput(merged, { contentTypeLabel: '应用缓存' })
    )
    const checkbox = li.querySelector('input') as HTMLInputElement
    expect(checkbox.disabled).toBe(false)
  })

  it('renders agent evidence as plain text when present', () => {
    const payload = '<img onerror=alert(1)>'
    const li = createScanItemElement({
      fileName: 'cache',
      path: 'C:\\Temp\\cache',
      typeLabel: 'test',
      sizeLabel: '880 MB',
      evidenceItems: [
        { source: 'agent', sourceLabel: 'Agent', summary: '模型判断依据' },
        { source: 'agent', sourceLabel: 'Agent', summary: payload }
      ]
    })

    const rows = li.querySelectorAll('.item-evidence-row')
    expect(rows).toHaveLength(2)
    expect(li.textContent).toContain('Agent')
    expect(li.textContent).toContain('模型判断依据')

    const summaries = li.querySelectorAll('.item-evidence-summary')
    expect(summaries[1]?.textContent).toBe(payload)
    expect(summaries[1]?.innerHTML).not.toContain('<img')
    expect(li.querySelector('img')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  ANALYZER_ONLY_AGENT_ADVICE_REASON,
  getJudgmentStatusLabel,
  isCandidateEquivalent,
  mapRuleScanItem,
  mapSpaceScanItem,
  mergeScanCandidates,
  normalizeCandidate,
  occupancyObservationFromSpaceItem
} from '../src/shared/candidate-model'
import { formatBytes } from '../src/shared/format-bytes'
import { buildScanItemRenderInput } from '../src/renderer/candidate-render'
import { applyAgentRecommendation } from '../src/main/agent/agent-candidate-mapper'
import { accumulateScanItemBatches, upsertScanItems } from '../src/shared/scan-item-accumulator'
import { buildCleanupPlan } from '../src/main/cleanup/plan-builder'
import type { ScanItem } from '../src/shared/types'

function legacyAnalyzer(overrides: Partial<ScanItem> & Pick<ScanItem, 'path'>): ScanItem {
  return mapSpaceScanItem({
    id: overrides.id ?? `analyzer:${overrides.path}`,
    ruleId: '__analyzer__',
    ruleName: overrides.ruleName ?? 'Large Dir',
    category: 'dangerous',
    contentType: overrides.contentType ?? 'large-dir',
    drive: overrides.drive ?? 'C:',
    path: overrides.path,
    size: overrides.size ?? 100,
    sizeIsEstimate: true,
    snapshotComplete: overrides.snapshotComplete ?? true,
    sizePartial: overrides.sizePartial,
    entryKind: overrides.entryKind ?? 'directory',
    deletable: false,
    autoSelect: false,
    source: 'analyzer',
    reason: overrides.reason ?? '磁盘空间占用分析（逻辑大小估算）',
    impact: overrides.impact,
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
    id: overrides.id ?? `rule-a:${overrides.path}`,
    ruleId: overrides.ruleId ?? 'rule-a',
    ruleName: overrides.ruleName ?? 'Rule A',
    category,
    contentType: overrides.contentType ?? 'app-cache',
    drive: overrides.drive ?? 'C:',
    path: overrides.path,
    size: overrides.size ?? 100,
    sizeIsEstimate: true,
    snapshotComplete: overrides.snapshotComplete ?? true,
    entryKind: 'directory',
    deletable: overrides.deletable ?? category !== 'dangerous',
    autoSelect: overrides.autoSelect ?? false,
    source: 'rule',
    reason: overrides.reason ?? '临时缓存',
    impact: overrides.impact,
    discoverySources: ['rule'],
    evidence: [],
    judgment: { status: 'pending', source: 'none', confidence: 'unknown', basis: [] },
    selection: { selectable: false },
    suggestedAction: 'none',
    ...overrides
  })
}

function mergePair(analyzer: ScanItem, rule: ScanItem): ScanItem {
  return mergeScanCandidates(analyzer, rule)
}

describe('candidate model', () => {
  it('maps analyzer items to identifying candidates that are not selectable', () => {
    const item = legacyAnalyzer({ path: 'C:\\Users', size: 50_000 })

    expect(item.judgment.status).toBe('identifying')
    expect(item.selection.selectable).toBe(false)
    expect(item.selection.notSelectableReason).toContain('正在识别')
    expect(item.deletable).toBe(false)
    expect(item.discoverySources).toEqual(['space-scan'])
    expect(getJudgmentStatusLabel(item.judgment.status)).toBe('正在识别')
    expect(item.occupancyObservation?.size).toBe(50_000)
  })

  it('maps legacy safe rule items to suggested selectable candidates', () => {
    const item = legacyRule({ path: 'C:\\Temp\\cache', category: 'safe', deletable: true })

    expect(item.judgment.status).toBe('suggested')
    expect(item.judgment.source).toBe('legacy-rule')
    expect(item.selection.selectable).toBe(true)
    expect(item.deletable).toBe(true)
    expect(item.suggestedAction).toBe('recycle')
    expect(item.occupancyObservation).toBeUndefined()
  })

  it('maps legacy recommended rule items to caution', () => {
    const item = legacyRule({
      path: 'C:\\Temp\\old',
      category: 'recommended',
      deletable: true,
      autoSelect: false
    })

    expect(item.judgment.status).toBe('caution')
    expect(item.selection.selectable).toBe(true)
  })

  it('maps legacy dangerous rule items to keep and not selectable', () => {
    const item = legacyRule({
      path: 'C:\\Program Files',
      category: 'dangerous',
      deletable: false
    })

    expect(item.judgment.status).toBe('keep')
    expect(item.selection.selectable).toBe(false)
  })

  it('uses rule execution snapshot when merging analyzer observation with rule candidate', () => {
    const analyzer = legacyAnalyzer({
      path: 'C:\\Temp\\cache',
      size: 900,
      snapshotComplete: false,
      sizePartial: true,
      reason: '磁盘空间占用分析（逻辑大小估算）'
    })
    const rule = legacyRule({
      path: 'C:\\Temp\\cache',
      category: 'safe',
      deletable: true,
      size: 880,
      snapshotComplete: true,
      reason: '临时缓存'
    })

    const merged = mergePair(analyzer, rule)

    expect(merged.size).toBe(880)
    expect(merged.snapshotComplete).toBe(true)
    expect(merged.selection.selectable).toBe(true)
    expect(merged.occupancyObservation?.size).toBe(900)
    expect(merged.occupancyObservation?.sizePartial).toBe(true)
    expect(merged.occupancyObservation?.snapshotComplete).toBe(false)
    expect(merged.evidence.some((e) => e.source === 'space-scan' && e.summary.includes('900'))).toBe(true)
  })

  it('produces the same execution snapshot regardless of merge order', () => {
    const analyzer = legacyAnalyzer({
      path: 'C:\\Temp\\cache',
      size: 900,
      snapshotComplete: false,
      sizePartial: true
    })
    const rule = legacyRule({
      path: 'C:\\Temp\\cache',
      category: 'safe',
      deletable: true,
      size: 880,
      snapshotComplete: true
    })

    const analyzerFirst = mergeScanCandidates(analyzer, rule)
    const ruleFirst = mergeScanCandidates(rule, analyzer)

    expect(analyzerFirst.size).toBe(880)
    expect(ruleFirst.size).toBe(880)
    expect(analyzerFirst.snapshotComplete).toBe(true)
    expect(ruleFirst.snapshotComplete).toBe(true)
    expect(analyzerFirst.occupancyObservation?.size).toBe(900)
    expect(ruleFirst.occupancyObservation?.size).toBe(900)
  })

  it('keeps validator-compatible rule fields after merge', () => {
    const analyzer = legacyAnalyzer({ path: 'C:\\Temp\\cache', size: 500 })
    const rule = legacyRule({
      path: 'C:\\Temp\\cache',
      category: 'safe',
      deletable: true,
      ruleId: 'temp-cache',
      id: 'temp-cache:C:\\Temp\\cache',
      ruleSource: 'builtin'
    })

    const merged = mergePair(analyzer, rule)

    expect(merged.id).toBe(`temp-cache:C:\\Temp\\cache`)
    expect(merged.ruleId).toBe('temp-cache')
    expect(merged.ruleSource).toBe('builtin')
    expect(merged.source).toBe('rule')
  })

  it('rejects incomplete rule execution snapshots for selection', () => {
    const item = legacyRule({
      path: 'C:\\Temp\\partial',
      category: 'safe',
      deletable: true,
      snapshotComplete: false
    })

    expect(item.selection.selectable).toBe(false)
    expect(item.deletable).toBe(false)
    expect(item.suggestedAction).toBe('none')
    expect(item.selection.notSelectableReason).toContain('快照不完整')
  })

  it('uses rule execution size in cleanup plan after merge', () => {
    const analyzer = legacyAnalyzer({ path: 'C:\\Temp\\cache', size: 900, snapshotComplete: false })
    const rule = legacyRule({
      path: 'C:\\Temp\\cache',
      category: 'safe',
      deletable: true,
      size: 880,
      snapshotComplete: true
    })
    const merged = mergePair(analyzer, rule)
    const plan = buildCleanupPlan('session-1', [merged])

    expect(plan.estimatedLogicalBytes).toBe(880)
    expect(plan.actions[0]?.estimatedLogicalBytes).toBe(880)
  })

  it('treats pending, keep, and uncertain as not selectable', () => {
    const pending = legacyAnalyzer({ path: 'C:\\A' })
    const keep = legacyRule({ path: 'C:\\B', category: 'dangerous', deletable: false })
    const uncertain = normalizeCandidate({
      ...legacyAnalyzer({ path: 'C:\\C' }),
      judgment: {
        status: 'uncertain',
        source: 'none',
        confidence: 'low',
        basis: ['信息不足']
      }
    })

    expect(pending.selection.selectable).toBe(false)
    expect(keep.selection.selectable).toBe(false)
    expect(uncertain.selection.selectable).toBe(false)
    expect(uncertain.selection.notSelectableReason).toContain('无法确定')
  })

  it('is idempotent when the same normalized batch is delivered twice', () => {
    const item = legacyAnalyzer({ path: 'C:\\A' })
    const once = upsertScanItems([], [item])
    const twice = upsertScanItems(once.items, [item])

    expect(once.upserted).toHaveLength(1)
    expect(twice.upserted).toHaveLength(0)
    expect(isCandidateEquivalent(once.items[0], twice.items[0])).toBe(true)
  })

  it('merges same path via upsert and keeps incremental batches idempotent', () => {
    const analyzer = legacyAnalyzer({
      path: 'C:\\Temp\\cache',
      size: 900,
      snapshotComplete: false,
      sizePartial: true
    })
    const rule = legacyRule({
      path: 'C:\\Temp\\cache',
      category: 'safe',
      deletable: true,
      size: 880,
      snapshotComplete: true
    })

    const live = accumulateScanItemBatches([[analyzer], [rule], [rule]])

    expect(live).toHaveLength(1)
    expect(live[0].discoverySources).toEqual(expect.arrayContaining(['space-scan', 'rule']))
    expect(live[0].judgment.status).toBe('suggested')
    expect(live[0].size).toBe(880)
    expect(live[0].occupancyObservation?.size).toBe(900)
  })

  it('derives occupancy observation from pure space items', () => {
    const analyzer = legacyAnalyzer({ path: 'C:\\Data', size: 42 })
    const obs = occupancyObservationFromSpaceItem(analyzer)
    expect(obs.size).toBe(42)
    expect(obs.source).toBe('space-scan')
  })

  it('uses consistent units between candidate size and space evidence', () => {
    const size = 30 * 1024 * 1024
    const analyzer = legacyAnalyzer({
      path: 'C:\\$Recycle.Bin',
      size,
      impact: '仅展示占用，不判断是否为垃圾'
    })
    const spaceEvidence = analyzer.evidence.find((entry) => entry.source === 'space-scan')
    const expected = formatBytes(size)

    expect(spaceEvidence?.summary).toContain(expected)
    expect(spaceEvidence?.summary).not.toContain('GB')

    const renderInput = buildScanItemRenderInput(analyzer, { contentTypeLabel: '大型目录' })
    expect(renderInput.sizeLabel).toBe(expected)
  })

  it('shows analyzer-only agent advice copy for all agent verdicts without cleanup authorization', () => {
    const analyzer = legacyAnalyzer({
      path: 'C:\\$Recycle.Bin',
      impact: '仅展示占用，不判断是否为垃圾'
    })
    const recommendation = {
      candidateRef: 'candidate-1',
      verdict: 'clean' as const,
      likelyContent: '回收站内容',
      reason: '可清理',
      impact: '释放空间',
      confidence: 'high' as const,
      basis: ['mock']
    }

    for (const verdict of ['clean', 'confirm', 'keep', 'uncertain'] as const) {
      const after = normalizeCandidate(
        applyAgentRecommendation(analyzer, { ...recommendation, verdict })
      )
      expect(after.judgment.source).toBe('agent')
      expect(after.selection.selectable).toBe(false)
      expect(after.deletable).toBe(false)
      expect(after.suggestedAction).toBe('none')
      expect(after.selection.notSelectableReason).toBe(ANALYZER_ONLY_AGENT_ADVICE_REASON)
      expect(after.selection.notSelectableReason).not.toContain('尚未启用智能判断')
      expect(after.selection.notSelectableReason).not.toContain('仅展示占用')
    }
  })
})

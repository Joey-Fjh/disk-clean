import { describe, expect, it } from 'vitest'
import { normalizeCandidate } from '../src/shared/candidate-model'
import {
  applyAgentRecommendation,
  applyAgentRecommendations,
  agentCannotExpandAnalyzerOnly,
  preserveLocalExecutionFacts,
  verdictToJudgmentStatus
} from '../src/main/agent/agent-candidate-mapper'
import type { ScanItem } from '../src/shared/types'

function baseItem(overrides: Partial<ScanItem> = {}): ScanItem {
  return normalizeCandidate({
    id: 'rule-1',
    ruleId: 'rule-a',
    ruleName: 'Temp',
    category: 'safe',
    contentType: 'system-temp',
    drive: 'C:',
    path: 'C:\\Temp\\a.tmp',
    size: 2048,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'file',
    deletable: true,
    autoSelect: true,
    source: 'rule',
    reason: 'temp',
    discoverySources: ['rule'],
    evidence: [],
    judgment: { status: 'suggested', source: 'legacy-rule', confidence: 'high', basis: ['rule'] },
    selection: { selectable: true },
    suggestedAction: 'recycle',
    ...overrides
  })
}

const recommendation = {
  candidateRef: 'candidate-1',
  verdict: 'clean' as const,
  likelyContent: '临时缓存',
  reason: '可安全清理',
  impact: '应用会重建',
  confidence: 'high' as const,
  basis: ['临时文件']
}

describe('agent candidate mapper', () => {
  it('maps four verdicts to judgment statuses', () => {
    expect(verdictToJudgmentStatus('clean')).toBe('suggested')
    expect(verdictToJudgmentStatus('confirm')).toBe('caution')
    expect(verdictToJudgmentStatus('keep')).toBe('keep')
    expect(verdictToJudgmentStatus('uncertain')).toBe('uncertain')
  })

  it('preserves local path size and snapshot fields', () => {
    const before = baseItem()
    const after = applyAgentRecommendation(before, recommendation)
    expect(preserveLocalExecutionFacts(before, after)).toBe(true)
    expect(after.judgment.source).toBe('agent')
    expect(after.agentInsight?.likelyContent).toBe('临时缓存')
  })

  it('does not make analyzer-only candidates selectable when agent says clean', () => {
    const analyzer = baseItem({
      id: 'space-1',
      source: 'analyzer',
      deletable: false,
      discoverySources: ['space-scan'],
      judgment: { status: 'pending', source: 'none', confidence: 'unknown', basis: [] }
    })
    const after = applyAgentRecommendation(analyzer, recommendation)
    expect(agentCannotExpandAnalyzerOnly(after)).toBe(true)
    expect(normalizeCandidate(after).selection.selectable).toBe(false)
  })

  it('keeps uncertain and keep verdicts conservative', () => {
    const item = baseItem()
    const uncertain = applyAgentRecommendation(item, { ...recommendation, verdict: 'uncertain' })
    const keep = applyAgentRecommendation(item, { ...recommendation, verdict: 'keep' })
    expect(normalizeCandidate(uncertain).selection.selectable).toBe(false)
    expect(normalizeCandidate(keep).selection.selectable).toBe(false)
  })

  it('does not expand deletable=false rule candidates', () => {
    const item = baseItem({ deletable: false, category: 'dangerous' })
    const after = applyAgentRecommendation(item, recommendation)
    expect(normalizeCandidate(after).selection.selectable).toBe(false)
  })

  it('applies recommendations by candidate ref mapping only', () => {
    const items = [baseItem({ id: 'a' }), baseItem({ id: 'b', path: 'C:\\Temp\\b.tmp' })]
    const refToId = new Map([
      ['candidate-1', 'a'],
      ['candidate-2', 'b']
    ])
    const { items: next, appliedCount } = applyAgentRecommendations(
      items,
      [recommendation, { ...recommendation, candidateRef: 'candidate-2', verdict: 'keep' }],
      refToId
    )
    expect(appliedCount).toBe(2)
    expect(next[0]?.judgment.source).toBe('agent')
    expect(next[1]?.judgment.status).toBe('keep')
  })
})

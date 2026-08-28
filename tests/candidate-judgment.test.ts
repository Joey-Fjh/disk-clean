import { describe, expect, it } from 'vitest'
import {
  hasLocalCleanupAuthorization,
  mergeAgentReviewIntoJudgment,
  resolveLocalJudgment
} from '../src/shared/candidate-judgment'
import { applyAgentJudgmentToItem, normalizeCandidate } from '../src/shared/candidate-model'
import type { ScanItem } from '../src/shared/types'

function ruleItem(overrides: Partial<ScanItem> = {}): ScanItem {
  return normalizeCandidate({
    id: 'rule-1',
    ruleId: 'rule-a',
    ruleName: 'Temp cache',
    category: 'safe',
    contentType: 'app-cache',
    drive: 'C:',
    path: 'C:\\Temp\\cache',
    size: 100,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'file',
    deletable: true,
    autoSelect: true,
    source: 'rule',
    discoverySources: ['rule'],
    evidence: [],
    judgment: { status: 'suggested', source: 'legacy-rule', confidence: 'high', basis: [] },
    selection: { selectable: true },
    suggestedAction: 'recycle',
    ...overrides
  })
}

describe('candidate judgment matrix', () => {
  it('grants cleanup only through local rule authorization', () => {
    const item = ruleItem()
    expect(hasLocalCleanupAuthorization(item)).toBe(true)
    const reviewed = applyAgentJudgmentToItem(item, {
      verdict: 'clean',
      confidence: 'high',
      basis: ['ok']
    })
    expect(normalizeCandidate(reviewed).selection.selectable).toBe(true)
    expect(reviewed.judgment.judgmentOrigin).toBe('local-rule-agent-reviewed')
  })

  it('does not let agent confirm expand analyzer-only items', () => {
    const item = normalizeCandidate(
      ruleItem({
        id: 'space-1',
        source: 'analyzer',
        deletable: false,
        discoverySources: ['space-scan'],
        judgment: {
          status: 'uncertain',
          source: 'none',
          confidence: 'unknown',
          basis: [],
          judgmentOrigin: 'space-evidence-only'
        }
      })
    )
    const reviewed = applyAgentJudgmentToItem(item, {
      verdict: 'clean',
      confidence: 'high',
      basis: ['looks safe']
    })
    expect(normalizeCandidate(reviewed).selection.selectable).toBe(false)
    expect(reviewed.judgment.judgmentOrigin).toBe('agent-advice-only')
  })

  it('downgrades uncertain agent review to cautious non-selectable', () => {
    const reviewed = applyAgentJudgmentToItem(ruleItem(), {
      verdict: 'uncertain',
      confidence: 'low',
      basis: ['unsure']
    })
    const normalized = normalizeCandidate(reviewed)
    expect(normalized.judgment.status).toBe('caution')
    expect(normalized.selection.selectable).toBe(false)
  })

  it('downgrades keep agent review and blocks cleanup', () => {
    const reviewed = applyAgentJudgmentToItem(ruleItem(), {
      verdict: 'keep',
      confidence: 'high',
      basis: ['important']
    })
    const normalized = normalizeCandidate(reviewed)
    expect(normalized.judgment.status).toBe('keep')
    expect(normalized.selection.selectable).toBe(false)
  })

  it('always blocks protected paths regardless of agent', () => {
    const local = resolveLocalJudgment(ruleItem(), true)
    const merged = mergeAgentReviewIntoJudgment(
      ruleItem(),
      local,
      { verdict: 'clean', confidence: 'high', basis: ['safe'] },
      true
    )
    expect(merged.judgmentOrigin).toBe('protected-policy')
    expect(merged.status).toBe('uncertain')
  })

  it('falls back to local judgment when agent review is absent', () => {
    const local = resolveLocalJudgment(ruleItem(), false)
    const merged = mergeAgentReviewIntoJudgment(ruleItem(), local, null, false)
    expect(merged).toEqual(local)
    expect(merged.source).toBe('legacy-rule')
  })
})

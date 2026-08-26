import { describe, expect, it } from 'vitest'
import { compileRuleDraftToRuleConfig } from '../src/main/rules/rule-draft-compiler'
import type { RuleDraftV1 } from '../src/shared/rule-layer-types'

const draft: RuleDraftV1 = {
  schemaVersion: '1',
  name: 'Draft rule',
  contentType: 'app-cache',
  basePlaceholders: ['%TEMP%'],
  subdirs: ['disk-clean-test-cache'],
  reason: 'cache',
  suggestedRisk: 'safe',
  source: 'agent-generated',
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('compileRuleDraftToRuleConfig', () => {
  it('uses conservative defaults on approval compile', () => {
    const rule = compileRuleDraftToRuleConfig(draft, 'abc')
    expect(rule.id).toBe('draft:abc')
    expect(rule.defaultChecked).toBe(false)
    expect(rule.cleanupStrategy).toBe('trash')
    expect(rule.nativeManaged).toBe(false)
  })

  it('does not make user-data deletable', () => {
    const rule = compileRuleDraftToRuleConfig(
      { ...draft, contentType: 'user-data', suggestedRisk: 'safe' },
      'abc'
    )
    expect(rule.deletable).toBe(false)
    expect(rule.category).toBe('dangerous')
  })
})

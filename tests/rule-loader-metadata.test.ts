import { describe, expect, it } from 'vitest'
import { sanitizeRulesForLoad } from '../src/main/rules/rule-layer-loader'
import type { RuleConfig } from '../src/shared/types'
import {
  detectInvalidRuleMetadataFields,
  isRuleActiveForScan,
  isRuleOrdinaryDeletable,
  sanitizeRuleForLoad
} from '../src/shared/rule-enforcement'

function baseRule(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return {
    id: 'test-rule',
    name: 'Test',
    category: 'safe',
    paths: ['%TEMP%\\cache'],
    globDirs: ['cache'],
    defaultChecked: false,
    ...overrides
  }
}

describe('sanitizeRuleForLoad', () => {
  it('quarantines rules when cleanupMethod is present but misspelled', () => {
    const rule = sanitizeRuleForLoad(baseRule({ cleanupMethod: 'system_managed' as never, deletable: true }))
    expect(detectInvalidRuleMetadataFields(baseRule({ cleanupMethod: 'system_managed' as never }))).toEqual([
      'cleanupMethod'
    ])
    expect(rule.reviewStatus).toBe('disabled')
    expect(rule.deletable).toBe(false)
    expect(isRuleActiveForScan(rule)).toBe(false)
    expect(isRuleOrdinaryDeletable(rule)).toBe(false)
    expect(rule.cleanupMethod).toBeUndefined()
    expect(rule.notes).toContain('cleanupMethod')
  })

  it('allows missing cleanupMethod without quarantine', () => {
    const rule = sanitizeRuleForLoad(baseRule({ cleanupMethod: undefined, deletable: undefined }))
    expect(detectInvalidRuleMetadataFields(rule)).toEqual([])
    expect(rule.reviewStatus).toBeUndefined()
    expect(isRuleOrdinaryDeletable(rule)).toBe(true)
  })

  it('sanitizes official loader batches through exported helper', () => {
    const [rule] = sanitizeRulesForLoad([
      baseRule({ cleanupMethod: 'manual' as never, reviewStatus: 'bogus' as never })
    ])
    expect(rule.reviewStatus).toBe('disabled')
    expect(rule.deletable).toBe(false)
  })
})

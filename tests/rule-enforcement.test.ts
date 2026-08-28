import { describe, expect, it } from 'vitest'
import {
  detectInvalidRuleMetadataFields,
  isRuleMetadataDeleteForbidden,
  isRuleActiveForScan,
  isRuleOrdinaryDeletable,
  normalizeRuleMetadata,
  parseCleanupMethod,
  parseReviewStatus,
  sanitizeRuleForLoad
} from '../src/shared/rule-enforcement'
import type { RuleConfig } from '../src/shared/types'

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

describe('rule enforcement', () => {
  it('rejects invalid metadata enums', () => {
    expect(parseCleanupMethod('trash')).toBe('trash')
    expect(parseCleanupMethod('evil')).toBeUndefined()
    expect(parseReviewStatus('disabled')).toBe('disabled')
    expect(parseReviewStatus('bogus')).toBeUndefined()
  })

  it('quarantines invalid cleanupMethod spelling instead of stripping field', () => {
    const raw = baseRule({ cleanupMethod: 'system_managed' as never, deletable: true })
    const rule = sanitizeRuleForLoad(raw)
    expect(detectInvalidRuleMetadataFields(raw)).toEqual(['cleanupMethod'])
    expect(rule.reviewStatus).toBe('disabled')
    expect(rule.deletable).toBe(false)
    expect(isRuleOrdinaryDeletable(rule)).toBe(false)
  })

  it('forces deletable false for non-trash cleanupMethod even if deletable omitted', () => {
    const normalized = normalizeRuleMetadata(
      baseRule({ cleanupMethod: 'system-managed', deletable: undefined })
    )
    expect(normalized.deletable).toBe(false)
    expect(isRuleOrdinaryDeletable(normalized)).toBe(false)
  })

  it('blocks malicious combination cleanupMethod trash with deletable true but manual method typo stripped', () => {
    const rule = normalizeRuleMetadata(baseRule({ cleanupMethod: 'manual' as never, deletable: true }))
    expect(isRuleMetadataDeleteForbidden(rule)).toBe(true)
    expect(isRuleOrdinaryDeletable(rule)).toBe(false)
  })

  it('excludes disabled rules from scan', () => {
    expect(isRuleActiveForScan(baseRule({ reviewStatus: 'disabled' }))).toBe(false)
    expect(isRuleActiveForScan(baseRule({ reviewStatus: 'verified' }))).toBe(true)
  })
})

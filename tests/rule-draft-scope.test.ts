import { describe, expect, it } from 'vitest'
import {
  enforceDraftRuleTargetLimit,
  MAX_APPROVABLE_RULE_TARGETS,
  validateScopeFieldExclusivity
} from '../src/main/rules/rule-draft-scope'
import {
  RuleDraftValidationError,
  validateRuleDraftInput
} from '../src/main/rules/rule-draft-validator'
import type { RuleDraftV1 } from '../src/shared/rule-layer-types'

const baseDraft: RuleDraftV1 = {
  schemaVersion: '1',
  name: 'Test',
  contentType: 'app-cache',
  basePlaceholders: ['%TEMP%'],
  subdirs: ['vendor-cache'],
  reason: 'cache',
  suggestedRisk: 'recommended',
  source: 'user-import',
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('rule draft scope validation', () => {
  it('rejects mixed subdirs and globDirs', () => {
    expect(() =>
      validateRuleDraftInput({
        ...baseDraft,
        subdirs: ['Vendor/Cache'],
        globDirs: ['Vendor/Cache']
      })
    ).toThrow(/只能三选一/)
  })

  it('rejects glob bypass patterns', () => {
    const bypassPatterns = ['*.*', '{*,**}', '**/{*,**}', '@(foo|*)', '[A-Z]*']
    for (const globDir of bypassPatterns) {
      expect(() =>
        validateRuleDraftInput({
          ...baseDraft,
          subdirs: undefined,
          globDirs: [globDir]
        })
      ).toThrow(RuleDraftValidationError)
    }
  })

  it('rejects glob metacharacters in subdirs', () => {
    expect(() =>
      validateRuleDraftInput({
        ...baseDraft,
        subdirs: ['Vendor/*']
      })
    ).toThrow(/glob 元字符/)
  })

  it('rejects relativePatterns under broad ProgramData base', () => {
    expect(() =>
      validateRuleDraftInput({
        ...baseDraft,
        basePlaceholders: ['%ProgramData%'],
        subdirs: undefined,
        relativePatterns: ['Microsoft/*.tmp']
      })
    ).toThrow(/不允许 relativePatterns/)
  })

  it('rejects broad-base globDirs with wildcard first segment', () => {
    expect(() =>
      validateRuleDraftInput({
        ...baseDraft,
        basePlaceholders: ['%ProgramData%'],
        subdirs: undefined,
        globDirs: ['*/Cache']
      })
    ).toThrow(/字面目录/)
  })

  it('allows literal globDirs under ProgramData', () => {
    const draft = validateRuleDraftInput({
      ...baseDraft,
      basePlaceholders: ['%ProgramData%'],
      subdirs: undefined,
      globDirs: ['Microsoft/Windows/Caches']
    })
    expect(draft.globDirs).toEqual(['Microsoft/Windows/Caches'])
  })

  it('validateScopeFieldExclusivity rejects zero scope fields', () => {
    expect(() =>
      validateScopeFieldExclusivity({
        ...baseDraft,
        subdirs: undefined
      })
    ).toThrow(/只能三选一/)
  })
})

describe('enforceDraftRuleTargetLimit', () => {
  it('downgrades draft rules when target count exceeds limit', () => {
    const rule = {
      id: 'draft:abc',
      deletable: true,
      paths: ['%TEMP%']
    }
    const result = enforceDraftRuleTargetLimit(rule, MAX_APPROVABLE_RULE_TARGETS + 1)
    expect(result.downgraded).toBe(true)
    expect(result.rule.deletable).toBe(false)
    expect(result.message).toMatch(/超过上限/)
  })

  it('does not downgrade non-draft rules', () => {
    const rule = { id: 'official-system', deletable: true, paths: ['%TEMP%'] }
    const result = enforceDraftRuleTargetLimit(rule, MAX_APPROVABLE_RULE_TARGETS + 1)
    expect(result.downgraded).toBe(false)
    expect(result.rule.deletable).toBe(true)
  })
})

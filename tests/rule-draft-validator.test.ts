import { describe, expect, it } from 'vitest'
import {
  RuleDraftValidationError,
  validateRuleDraftInput
} from '../src/main/rules/rule-draft-validator'

const validDraft = {
  schemaVersion: '1',
  name: 'Test cache draft',
  contentType: 'app-cache',
  basePlaceholders: ['%LOCALAPPDATA%'],
  subdirs: ['Vendor/Cache'],
  reason: 'Vendor cache directory',
  suggestedRisk: 'recommended',
  source: 'user-import',
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('validateRuleDraftInput', () => {
  it('accepts valid v1 draft', () => {
    const draft = validateRuleDraftInput(validDraft)
    expect(draft.name).toBe('Test cache draft')
    expect(draft.basePlaceholders).toEqual(['%LOCALAPPDATA%'])
  })

  it('rejects unknown fields', () => {
    expect(() => validateRuleDraftInput({ ...validDraft, extra: true })).toThrow(
      RuleDraftValidationError
    )
  })

  it('rejects forbidden authorization fields', () => {
    expect(() => validateRuleDraftInput({ ...validDraft, deletable: true })).toThrow(
      /禁止字段/
    )
    expect(() => validateRuleDraftInput({ ...validDraft, defaultChecked: true })).toThrow(
      /禁止字段/
    )
  })

  it('rejects absolute paths', () => {
    expect(() =>
      validateRuleDraftInput({
        ...validDraft,
        subdirs: ['C:\\Users\\cache']
      })
    ).toThrow(/绝对路径/)
  })

  it('rejects path traversal', () => {
    expect(() =>
      validateRuleDraftInput({
        ...validDraft,
        subdirs: ['..\\cache']
      })
    ).toThrow(/目录穿越/)
  })

  it('rejects unanchored glob patterns', () => {
    expect(() =>
      validateRuleDraftInput({
        ...validDraft,
        subdirs: undefined,
        globDirs: ['**/*']
      })
    ).toThrow(/字面目录锚点/)
  })
})

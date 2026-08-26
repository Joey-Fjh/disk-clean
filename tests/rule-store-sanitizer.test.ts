import { describe, expect, it } from 'vitest'
import { sanitizeDraftStore, sanitizeStoredRuleDraft, assertImportJsonSize } from '../src/main/rules/rule-store-sanitizer'
import { RuleDraftValidationError } from '../src/main/rules/rule-draft-validator'

const validDraft = {
  id: 'draft-1',
  origin: 'user-import',
  status: 'enabled',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  draft: {
    schemaVersion: '1',
    name: 'Test',
    contentType: 'app-cache',
    basePlaceholders: ['%TEMP%'],
    subdirs: ['vendor-cache'],
    reason: 'cache',
    suggestedRisk: 'recommended',
    source: 'user-import',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  preview: {
    sessionId: 's1',
    sessionFingerprint: 's1:1:0',
    matchCount: 1,
    ruleTargetCount: 1,
    estimatedBytes: 100,
    excludedProtectedCount: 0,
    protectedTargetCount: 0,
    drives: ['C:'],
    samples: [{ candidateId: 'c1', pathSummary: 'cache/file', size: 100 }],
    warnings: [],
    approvable: true,
    scope: {
      basePlaceholders: ['%TEMP%'],
      subdirs: ['vendor-cache'],
      suggestedRisk: 'recommended',
      reason: 'cache'
    },
    previewedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('rule store sanitizer', () => {
  it('rejects enabled draft without preview on load', () => {
    const result = sanitizeDraftStore({
      schemaVersion: '1',
      drafts: [{ ...validDraft, preview: undefined }]
    })
    expect(result.state.drafts).toHaveLength(0)
    expect(result.isolated).toHaveLength(1)
  })

  it('accepts validated draft after re-validation', () => {
    const record = sanitizeStoredRuleDraft({
      ...validDraft,
      status: 'validated',
      preview: undefined
    })
    expect(record?.status).toBe('validated')
  })

  it('enforces import json size limit', () => {
    expect(() => assertImportJsonSize('x'.repeat(40_000), 1024)).toThrow(RuleDraftValidationError)
  })
})

import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'disk-clean-draft-life-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => userData
  }
}))
import { copyBuiltInRuleAsDraft, updateRuleDraftContent } from '../src/main/rules/rule-layer-service'
import { clearRulesLayerCache } from '../src/main/rules/rule-layer-loader'
import { saveRuleDraftRecord } from '../src/main/rules/rule-draft-store'
import type { RuleConfig } from '../src/shared/types'

const builtinRule: RuleConfig = {
  id: 'chrome-cache',
  name: 'Chrome 缓存',
  category: 'safe',
  contentType: 'browser-cache',
  paths: ['%TEMP%'],
  subdirs: ['chrome-cache'],
  defaultChecked: false,
  reason: '浏览器缓存',
  requiresAppClosed: true,
  rebuildable: true
}

describe('rule draft lifecycle', () => {
  beforeEach(() => {
    clearRulesLayerCache()
  })

  afterEach(() => {
    clearRulesLayerCache()
  })

  it('copies built-in rule as user draft with requiresAppClosed preserved', () => {
    const draft = copyBuiltInRuleAsDraft(builtinRule)
    expect(draft.draft.source).toBe('user-import')
    expect(draft.draft.requiresAppClosed).toBe(true)
    expect(draft.draft.name).toContain('副本')
  })

  it('clears preview metadata after edit', () => {
    const created = copyBuiltInRuleAsDraft(builtinRule)
    const withPreview = {
      ...created,
      status: 'previewed' as const,
      preview: {
        sessionId: 's1',
        sessionFingerprint: 'fp',
        matchCount: 1,
        ruleTargetCount: 1,
        estimatedBytes: 1,
        excludedProtectedCount: 0,
        protectedTargetCount: 0,
        drives: ['C:'],
        samples: [],
        warnings: [],
        approvable: true,
        scope: {
          basePlaceholders: created.draft.basePlaceholders,
          suggestedRisk: created.draft.suggestedRisk,
          reason: created.draft.reason
        },
        previewedAt: new Date().toISOString()
      },
      sessionId: 's1',
      sessionFingerprint: 'fp'
    }
    saveRuleDraftRecord(withPreview)

    const updated = updateRuleDraftContent(created.id, { name: 'Chrome 缓存（已编辑）' })
    expect(updated.preview).toBeUndefined()
    expect(updated.sessionId).toBeUndefined()
    expect(updated.sessionFingerprint).toBeUndefined()
    expect(updated.status).toBe('validated')
  })

  it('blocks editing enabled drafts', () => {
    const created = copyBuiltInRuleAsDraft(builtinRule)
    const preview = {
      sessionId: 's1',
      sessionFingerprint: 'fp',
      matchCount: 1,
      ruleTargetCount: 1,
      estimatedBytes: 1,
      excludedProtectedCount: 0,
      protectedTargetCount: 0,
      drives: ['C:'],
      samples: [],
      warnings: [],
      approvable: true,
      scope: {
        basePlaceholders: created.draft.basePlaceholders,
        subdirs: created.draft.subdirs,
        suggestedRisk: created.draft.suggestedRisk,
        reason: created.draft.reason
      },
      previewedAt: new Date().toISOString()
    }
    saveRuleDraftRecord({ ...created, status: 'enabled', preview, sessionId: 's1', sessionFingerprint: 'fp' })
    expect(() => updateRuleDraftContent(created.id, { name: 'x' })).toThrow(/停用/)
  })
})

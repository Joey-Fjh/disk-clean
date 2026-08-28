import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importCustomRules } from '../src/main/rules'
import { listRuleDrafts } from '../src/main/rules/rule-draft-store'
import { compileRuleDraftToRuleConfig } from '../src/main/rules/rule-draft-compiler'
import { clearRulesLayerCache } from '../src/main/rules/rule-layer-loader'
import { resetRuleLayerUserState } from '../src/main/rules/rule-layer-service'

const userData = mkdtempSync(join(tmpdir(), 'disk-clean-import-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => userData
  }
}))

describe('legacy custom rule import', () => {
  beforeEach(() => {
    clearRulesLayerCache()
    resetRuleLayerUserState()
  })

  afterEach(() => {
    clearRulesLayerCache()
    resetRuleLayerUserState()
  })

  it('preserves requiresAppClosed when importing legacy RuleConfig JSON', () => {
    const imported = importCustomRules([
      {
        id: 'legacy-browser-cache',
        name: '浏览器缓存',
        category: 'safe',
        contentType: 'browser-cache',
        paths: ['%TEMP%'],
        subdirs: ['browser-cache'],
        defaultChecked: false,
        reason: '浏览器缓存',
        rebuildable: true,
        requiresAppClosed: true
      }
    ])
    expect(imported).toBe(1)

    const draft = listRuleDrafts().find((entry) => entry.draft.name === '浏览器缓存')
    expect(draft?.draft.requiresAppClosed).toBe(true)

    const compiled = compileRuleDraftToRuleConfig(draft!.draft, draft!.id)
    expect(compiled.requiresAppClosed).toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { getLayeredActiveRules } from '../src/main/rules/rule-layer-service'
import { clearRulesLayerCache, loadOfficialRulePacks } from '../src/main/rules/rule-layer-loader'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/disk-clean-test' }
}))

describe('builtin rule audit enforcement', () => {
  it('excludes reviewStatus disabled rules from active rules', () => {
    clearRulesLayerCache()
    const active = getLayeredActiveRules()
    expect(active.find((rule) => rule.id === 'app-logs')).toBeUndefined()
  })

  it('narrows browser cache globDirs away from broad **/Cache', () => {
    clearRulesLayerCache()
    const rules = loadOfficialRulePacks().flatMap((pack) => pack.rules)
    const chrome = rules.find((rule) => rule.id === 'chrome-cache')
    expect(chrome).toBeDefined()
    expect(chrome?.globDirs?.some((g) => g.includes('**/Cache'))).toBe(false)
    expect(chrome?.globDirs?.some((g) => g.includes('Default\\Cache'))).toBe(true)
  })
})

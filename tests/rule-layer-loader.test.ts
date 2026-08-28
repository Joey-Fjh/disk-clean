import { describe, expect, it } from 'vitest'
import {
  clearRulesLayerCache,
  loadCoreSafetyPolicy,
  loadDetectionHeuristics,
  loadOfficialRulePacks,
  loadRulesBundle
} from '../src/main/rules/rule-layer-loader'

describe('rule layer loader', () => {
  it('loads protected paths separately from rule packs', () => {
    clearRulesLayerCache()
    const safety = loadCoreSafetyPolicy()
    const bundle = loadRulesBundle()
    const packs = loadOfficialRulePacks()

    expect(safety.protectedPaths.length).toBeGreaterThan(0)
    expect(safety.pathAccessPolicy.denyRead.length).toBeGreaterThan(0)
    expect(bundle.protectedPaths).toEqual(safety.protectedPaths)
    expect(packs.length).toBeGreaterThan(0)
    expect(bundle.rules.length).toBeGreaterThan(0)
    expect(bundle.rules.some((rule) => rule.id === 'user-temp' || rule.id === 'windows-temp')).toBe(
      true
    )
  })

  it('loads generic heuristics without cleanup authorization fields', () => {
    clearRulesLayerCache()
    const heuristics = loadDetectionHeuristics()
    expect(heuristics.length).toBeGreaterThan(0)
    for (const heuristic of heuristics) {
      expect(heuristic).not.toHaveProperty('deletable')
      expect(heuristic).not.toHaveProperty('defaultChecked')
    }
  })
})

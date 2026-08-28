import { describe, expect, it } from 'vitest'
import { clearRulesLayerCache, loadCoreSafetyPolicy, loadPathAccessPolicy } from '../src/main/rules/rule-layer-loader'

describe('path access policy loader', () => {
  it('loads runtime policy with string arrays', () => {
    clearRulesLayerCache()
    const policy = loadPathAccessPolicy()
    expect(Array.isArray(policy.denyRead)).toBe(true)
    expect(policy.denyRead.every((entry) => typeof entry === 'string')).toBe(true)
    expect(Array.isArray(policy.readOnlyHighRisk)).toBe(true)
    expect(Array.isArray(policy.denyDelete)).toBe(true)
  })

  it('exposes policy through core safety policy', () => {
    clearRulesLayerCache()
    const safety = loadCoreSafetyPolicy()
    expect(safety.pathAccessPolicy).toBeDefined()
    expect(safety.pathAccessPolicy.denyRead.length).toBeGreaterThan(0)
  })
})

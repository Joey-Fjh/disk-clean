import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSessionMeasureCache,
  getSessionMeasureCacheStats,
  measurePathDetailed
} from '../src/main/scanner/measure-size'

describe('session measure cache', () => {
  beforeEach(() => {
    clearSessionMeasureCache()
  })

  it('reuses cached measurements within a scan session', async () => {
    const target = process.cwd()
    await measurePathDetailed(target, 2, undefined, true)
    await measurePathDetailed(target, 2, undefined, true)
    const stats = getSessionMeasureCacheStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
  })

  it('clears cache between scans', async () => {
    const target = process.cwd()
    await measurePathDetailed(target, 2, undefined, true)
    clearSessionMeasureCache()
    await measurePathDetailed(target, 2, undefined, true)
    const stats = getSessionMeasureCacheStats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(1)
  })
})

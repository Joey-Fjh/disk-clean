import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import {
  clearSessionMeasureCache,
  getSessionMeasureCacheStats,
  measurePathDetailed
} from '../src/main/scanner/measure-size'

function createSmallTree(root: string): void {
  mkdirSync(join(root, 'nested'), { recursive: true })
  writeFileSync(join(root, 'a.txt'), 'hello')
  writeFileSync(join(root, 'nested', 'b.txt'), 'world')
}

describe('session measure cache', () => {
  let tempDir = ''

  beforeEach(() => {
    clearSessionMeasureCache()
    tempDir = mkdtempSync(join(tmpdir(), 'disk-clean-cache-'))
    createSmallTree(tempDir)
  })

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  it('reuses cached measurements within a scan session', async () => {
    await measurePathDetailed(tempDir, 2, undefined, true)
    await measurePathDetailed(tempDir, 2, undefined, true)
    const stats = getSessionMeasureCacheStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
  })

  it('clears cache between scans', async () => {
    await measurePathDetailed(tempDir, 2, undefined, true)
    clearSessionMeasureCache()
    await measurePathDetailed(tempDir, 2, undefined, true)
    const stats = getSessionMeasureCacheStats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(1)
  })

  it('does not cache incomplete measurements', async () => {
    await measurePathDetailed(tempDir, 0, undefined, true)
    await measurePathDetailed(tempDir, 0, undefined, true)
    const stats = getSessionMeasureCacheStats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(2)
  })

  it('does not cache cancelled measurements', async () => {
    const controller = new AbortController()
    controller.abort()
    await measurePathDetailed(tempDir, 2, controller.signal, true)
    await measurePathDetailed(tempDir, 2, undefined, true)
    const stats = getSessionMeasureCacheStats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(2)
  })

  it('isolates cache entries by maxDepth', async () => {
    await measurePathDetailed(tempDir, 1, undefined, true)
    await measurePathDetailed(tempDir, 2, undefined, true)
    const stats = getSessionMeasureCacheStats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(2)
    expect(stats.entries).toBe(2)
  })
})

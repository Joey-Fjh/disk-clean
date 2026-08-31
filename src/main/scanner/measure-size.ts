import { join } from 'path'
import { readdir, stat, lstat } from 'fs/promises'
import type { RuleConfig } from '../../shared/types'
import { normalizeScanPath } from '../../shared/scan-path'
import { isScanCancelled } from './scan-controller'

const SIZE_TIMEOUT_MS = 6000
export const DEFAULT_MEASURE_MAX_DEPTH = 32
export const ANALYZER_MEASURE_MAX_DEPTH = 8
export const VALIDATION_MEASURE_TIMEOUT_MS = 6000

export interface PathMeasureResult {
  size: number
  incomplete: boolean
}

const sessionMeasureCache = new Map<string, PathMeasureResult>()
let sessionCacheHits = 0
let sessionCacheMisses = 0

function measureCacheKey(targetPath: string, maxDepth: number): string {
  return `${normalizeScanPath(targetPath)}|${maxDepth}`
}

export function clearSessionMeasureCache(): void {
  sessionMeasureCache.clear()
  sessionCacheHits = 0
  sessionCacheMisses = 0
}

export function getSessionMeasureCacheStats(): {
  hits: number
  misses: number
  entries: number
} {
  return {
    hits: sessionCacheHits,
    misses: sessionCacheMisses,
    entries: sessionMeasureCache.size
  }
}

async function measurePathInternal(
  targetPath: string,
  depth: number,
  maxDepth: number,
  signal?: AbortSignal
): Promise<PathMeasureResult> {
  if (signal?.aborted || isScanCancelled()) {
    return { size: 0, incomplete: true }
  }

  try {
    const info = await lstat(targetPath)
    if (info.isSymbolicLink()) return { size: 0, incomplete: false }
    if (info.isFile()) return { size: info.size, incomplete: false }
    if (!info.isDirectory()) return { size: 0, incomplete: false }

    let total = 0
    let incomplete = false
    const entries = await readdir(targetPath, { withFileTypes: true })

    for (const entry of entries) {
      if (signal?.aborted || isScanCancelled()) {
        return { size: total, incomplete: true }
      }
      if (entry.isSymbolicLink()) continue

      const child = join(targetPath, entry.name)
      try {
        if (entry.isDirectory()) {
          if (depth >= maxDepth) {
            incomplete = true
            continue
          }
          const childResult = await measurePathInternal(child, depth + 1, maxDepth, signal)
          total += childResult.size
          if (childResult.incomplete) incomplete = true
        } else if (entry.isFile()) {
          const fileStat = await stat(child)
          total += fileStat.size
        }
      } catch {
        incomplete = true
      }
    }

    return { size: total, incomplete }
  } catch {
    return { size: 0, incomplete: true }
  }
}

export async function measurePathDetailedWithTimeout(
  targetPath: string,
  maxDepth = DEFAULT_MEASURE_MAX_DEPTH,
  timeoutMs = VALIDATION_MEASURE_TIMEOUT_MS
): Promise<PathMeasureResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await measurePathDetailed(targetPath, maxDepth, controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}

export async function measurePathDetailed(
  targetPath: string,
  maxDepth = DEFAULT_MEASURE_MAX_DEPTH,
  signal?: AbortSignal,
  useSessionCache = false
): Promise<PathMeasureResult> {
  if (useSessionCache) {
    const key = measureCacheKey(targetPath, maxDepth)
    const cached = sessionMeasureCache.get(key)
    if (cached) {
      sessionCacheHits += 1
      return cached
    }
    sessionCacheMisses += 1
    const result = await measurePathInternal(targetPath, 0, maxDepth, signal)
    sessionMeasureCache.set(key, result)
    return result
  }
  return measurePathInternal(targetPath, 0, maxDepth, signal)
}

export async function getPathSize(
  targetPath: string,
  depth = 0,
  maxDepth = DEFAULT_MEASURE_MAX_DEPTH,
  signal?: AbortSignal
): Promise<number> {
  if (depth > 0) {
    const result = await measurePathInternal(targetPath, depth, maxDepth, signal)
    return result.size
  }
  const result = await measurePathInternal(targetPath, 0, maxDepth, signal)
  return result.size
}

function shouldListChildren(rule: RuleConfig): boolean {
  return rule.category !== 'dangerous' && rule.deletable !== false
}

export async function measurePathSize(targetPath: string, rule: RuleConfig, signal?: AbortSignal): Promise<number> {
  const maxDepth = shouldListChildren(rule) ? DEFAULT_MEASURE_MAX_DEPTH : 2
  const controller = new AbortController()
  const onParentAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onParentAbort)

  const timeout = setTimeout(() => controller.abort(), SIZE_TIMEOUT_MS)

  try {
    if (isScanCancelled()) return 0
    const result = await measurePathDetailed(targetPath, maxDepth, controller.signal, true)
    return result.size
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onParentAbort)
  }
}

export async function measurePathSizeDetailed(
  targetPath: string,
  rule: RuleConfig,
  signal?: AbortSignal
): Promise<PathMeasureResult> {
  const maxDepth = shouldListChildren(rule) ? DEFAULT_MEASURE_MAX_DEPTH : 2
  const controller = new AbortController()
  const onParentAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onParentAbort)
  const timeout = setTimeout(() => controller.abort(), SIZE_TIMEOUT_MS)

  try {
    if (isScanCancelled()) return { size: 0, incomplete: true }
    return await measurePathDetailed(targetPath, maxDepth, controller.signal)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onParentAbort)
  }
}

import type { InvestigationToolName } from '../../../shared/investigation-limits'
import { INVESTIGATION_LIMITS } from '../../../shared/investigation-limits'
import type { InvestigationToolResult } from '../../../shared/investigation-types'
import { measureJsonBytes } from './tool-result-sanitize'

function cloneResult<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export interface InvestigationCacheKey {
  fingerprint: string
  candidateRef: string
  toolName: InvestigationToolName
  relativePath: string
  limit?: number
  depth?: number
}

function cacheKeyString(key: InvestigationCacheKey): string {
  return JSON.stringify({
    fingerprint: key.fingerprint,
    candidateRef: key.candidateRef,
    toolName: key.toolName,
    relativePath: key.relativePath,
    limit: key.limit ?? null,
    depth: key.depth ?? null
  })
}

export class InvestigationResultCache {
  private readonly entries = new Map<string, InvestigationToolResult>()
  private totalBytes = 0

  get(key: InvestigationCacheKey): InvestigationToolResult | undefined {
    const stored = this.entries.get(cacheKeyString(key))
    return stored ? cloneResult(stored) : undefined
  }

  set(key: InvestigationCacheKey, value: InvestigationToolResult): void {
    const serialized = cacheKeyString(key)
    const existing = this.entries.get(serialized)
    if (existing) {
      this.totalBytes -= measureJsonBytes(existing)
      this.entries.delete(serialized)
    }

    const frozen = cloneResult(value)
    const bytes = measureJsonBytes(frozen)
    if (this.entries.size >= INVESTIGATION_LIMITS.MAX_CACHE_ENTRIES) {
      const firstKey = this.entries.keys().next().value as string | undefined
      if (firstKey) {
        const removed = this.entries.get(firstKey)
        if (removed) this.totalBytes -= measureJsonBytes(removed)
        this.entries.delete(firstKey)
      }
    }
    if (this.totalBytes + bytes > INVESTIGATION_LIMITS.MAX_CACHE_BYTES) {
      return
    }

    this.entries.set(serialized, frozen)
    this.totalBytes += bytes
  }

  clearAll(): void {
    this.entries.clear()
    this.totalBytes = 0
  }
}

let investigationCache = new InvestigationResultCache()

export function getInvestigationResultCache(): InvestigationResultCache {
  return investigationCache
}

export function setInvestigationResultCacheForTests(cache: InvestigationResultCache): void {
  investigationCache = cache
}

export function buildInvestigationCacheKey(input: {
  fingerprint: string
  candidateRef: string
  toolName: InvestigationToolName
  relativePath: string
  limit?: number
  depth?: number
}): InvestigationCacheKey {
  return {
    fingerprint: input.fingerprint,
    candidateRef: input.candidateRef,
    toolName: input.toolName,
    relativePath: input.relativePath,
    limit: input.limit,
    depth: input.depth
  }
}

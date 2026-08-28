import { describe, expect, it } from 'vitest'
import { evaluateSessionCleanupAuthorization } from '../src/shared/session-cleanup-authorization'
import { normalizeCandidate } from '../src/shared/candidate-model'
import type { ScanItem } from '../src/shared/types'

function item(partial: Partial<ScanItem> & Pick<ScanItem, 'id' | 'path'>): ScanItem {
  return normalizeCandidate({
    ruleId: partial.ruleId ?? '__analyzer__',
    ruleName: partial.ruleName ?? 'Large',
    category: partial.category ?? 'dangerous',
    contentType: partial.contentType ?? 'large-dir',
    drive: 'C:',
    size: partial.size ?? 1024,
    sizeIsEstimate: true,
    snapshotComplete: partial.snapshotComplete ?? true,
    entryKind: partial.entryKind ?? 'directory',
    deletable: partial.deletable ?? false,
    autoSelect: false,
    source: partial.source ?? 'analyzer',
    discoverySources: partial.discoverySources ?? ['space-scan'],
    evidence: partial.evidence ?? [],
    judgment: partial.judgment ?? {
      status: 'uncertain',
      source: 'none',
      confidence: 'unknown',
      basis: ['空间扫描']
    },
    selection: partial.selection ?? { selectable: false },
    suggestedAction: partial.suggestedAction ?? 'none',
    ...partial
  })
}

describe('session cleanup authorization policy', () => {
  it('authorizes agent-session when agent explicitly suggests clean', () => {
    const candidate = item({
      id: 'a1',
      path: 'C:\\Temp\\cache',
      executionSafety: 'agent-confirmable',
      judgment: {
        status: 'caution',
        source: 'agent',
        confidence: 'high',
        basis: ['临时缓存'],
        judgmentOrigin: 'agent-session',
        agentVerdict: 'clean'
      }
    })
    const result = evaluateSessionCleanupAuthorization({
      candidate,
      rule: null,
      protectedPath: false
    })
    expect(result.authorized).toBe(true)
    expect(result.source).toBe('agent-session')
  })

  it('rejects keep and uncertain agent verdicts', () => {
    for (const verdict of ['keep', 'uncertain'] as const) {
      const candidate = item({
        id: 'a2',
        path: 'C:\\Temp\\x',
        judgment: {
          status: verdict === 'keep' ? 'keep' : 'uncertain',
          source: 'agent',
          confidence: 'medium',
          basis: ['test'],
          agentVerdict: verdict
        }
      })
      expect(evaluateSessionCleanupAuthorization({ candidate, rule: null, protectedPath: false }).authorized).toBe(
        false
      )
    }
  })

  it('rejects space-only evidence without agent authorization', () => {
    const candidate = item({
      id: 'space',
      path: 'C:\\Big',
      discoverySources: ['space-scan'],
      judgment: {
        status: 'uncertain',
        source: 'none',
        confidence: 'unknown',
        basis: ['空间扫描'],
        judgmentOrigin: 'space-evidence-only'
      }
    })
    const result = evaluateSessionCleanupAuthorization({
      candidate,
      rule: null,
      protectedPath: false
    })
    expect(result.authorized).toBe(false)
    expect(result.code).toBe('NOT_AUTHORIZED')
  })

  it('rejects protected paths', () => {
    const candidate = item({
      id: 'p1',
      path: 'C:\\Windows\\Temp',
      judgment: {
        status: 'uncertain',
        source: 'local-policy',
        confidence: 'high',
        basis: ['protected'],
        judgmentOrigin: 'protected-policy'
      }
    })
    const result = evaluateSessionCleanupAuthorization({
      candidate,
      rule: null,
      protectedPath: true
    })
    expect(result.authorized).toBe(false)
    expect(result.code).toBe('PROTECTED_PATH')
  })
})

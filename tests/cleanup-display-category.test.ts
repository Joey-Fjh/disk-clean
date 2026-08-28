import { describe, expect, it } from 'vitest'
import { normalizeCandidate } from '../src/shared/candidate-model'
import {
  groupItemsByDisplayCategory,
  isCleanupActionBatchDeletable,
  resolveCleanupActionKind,
  resolveCleanupDisplayCategory
} from '../src/shared/cleanup-display-category'
import type { ScanItem } from '../src/shared/types'

function item(overrides: Partial<ScanItem> = {}): ScanItem {
  return normalizeCandidate({
    id: 'x',
    ruleId: 'rule-a',
    ruleName: 'Temp',
    category: 'safe',
    contentType: 'system-temp',
    drive: 'C:',
    path: 'C:\\Temp\\cache',
    size: 100,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    deletable: true,
    autoSelect: true,
    source: 'rule',
    discoverySources: ['rule'],
    evidence: [],
    judgment: {
      status: 'suggested',
      source: 'legacy-rule',
      confidence: 'high',
      basis: [],
      judgmentOrigin: 'local-rule'
    },
    selection: { selectable: true },
    suggestedAction: 'recycle',
    ...overrides
  })
}

describe('cleanup display category', () => {
  it('falls back to legacy category when judgment is missing', () => {
    const legacy = {
      id: 'legacy',
      category: 'safe' as const,
      ruleName: 'rule',
      name: 'legacy',
      path: 'C:\\x',
      size: 1,
      drive: 'C:',
      contentType: 'system-temp' as const,
      reason: '',
      impact: ''
    }
    expect(resolveCleanupDisplayCategory(legacy as ScanItem)).toBe('recommended-clean')
  })

  it('maps protected policy to space occupancy not delete', () => {
    const protectedItem = item({
      judgment: {
        status: 'uncertain',
        source: 'local-policy',
        confidence: 'high',
        basis: [],
        judgmentOrigin: 'protected-policy'
      },
      deletable: false
    })
    expect(resolveCleanupDisplayCategory(protectedItem)).toBe('space-occupancy')
    expect(resolveCleanupActionKind(protectedItem)).toBe('no-action')
    expect(isCleanupActionBatchDeletable(resolveCleanupActionKind(protectedItem))).toBe(false)
  })

  it('does not treat large files as recommended clean', () => {
    const large = item({
      source: 'analyzer',
      discoverySources: ['space-scan'],
      contentType: 'large-file',
      deletable: false,
      judgment: {
        status: 'uncertain',
        source: 'none',
        confidence: 'unknown',
        basis: [],
        judgmentOrigin: 'space-evidence-only'
      }
    })
    expect(resolveCleanupDisplayCategory(large)).toBe('space-occupancy')
  })

  it('groups items by display category', () => {
    const grouped = groupItemsByDisplayCategory([item(), item({ category: 'dangerous', judgment: { status: 'keep', source: 'legacy-rule', confidence: 'unknown', basis: [], judgmentOrigin: 'local-rule' } })])
    expect(grouped['recommended-clean'].length).toBe(1)
    expect(grouped['recommended-keep'].length).toBe(1)
  })
})

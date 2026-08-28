import { describe, expect, it } from 'vitest'
import { normalizeCandidate } from '../src/shared/candidate-model'
import { finalizeLocalScanItems } from '../src/main/scanner/scan-engine'
import type { ScanItem } from '../src/shared/types'

function ruleItem(path: string): ScanItem {
  return normalizeCandidate({
    id: `rule-a:${path}`,
    ruleId: 'rule-a',
    ruleName: 'Program Files cache',
    category: 'safe',
    contentType: 'app-cache',
    drive: 'C:',
    path,
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
      basis: ['命中规则'],
      judgmentOrigin: 'local-rule'
    },
    selection: { selectable: true },
    suggestedAction: 'recycle'
  })
}

describe('finalizeLocalScanItems protected policy', () => {
  it('overrides already-suggested rule items on protected paths', () => {
    const protectedPaths = ['C:\\Program Files']
    const item = ruleItem('C:\\Program Files\\Vendor\\cache')
    const [finalized] = finalizeLocalScanItems([item], protectedPaths)
    const normalized = normalizeCandidate(finalized)

    expect(normalized.judgment.judgmentOrigin).toBe('protected-policy')
    expect(normalized.judgment.status).toBe('uncertain')
    expect(normalized.deletable).toBe(false)
    expect(normalized.selection.selectable).toBe(false)
    expect(normalized.suggestedAction).toBe('none')
    expect(normalized.judgment.basis[0]).toContain('仅统计空间占用')
  })

  it('still finalizes identifying space items without protected override', () => {
    const item = normalizeCandidate({
      id: 'space-1',
      ruleId: '__analyzer__',
      ruleName: 'Large Dir',
      category: 'dangerous',
      contentType: 'large-dir',
      drive: 'C:',
      path: 'C:\\Custom\\cache',
      size: 100,
      sizeIsEstimate: true,
      snapshotComplete: true,
      entryKind: 'directory',
      deletable: false,
      autoSelect: false,
      source: 'analyzer',
      discoverySources: ['space-scan'],
      evidence: [],
      judgment: {
        status: 'identifying',
        source: 'none',
        confidence: 'unknown',
        basis: [],
        judgmentOrigin: 'space-evidence-only'
      },
      selection: { selectable: false },
      suggestedAction: 'none'
    })

    const [finalized] = finalizeLocalScanItems([item], [])
    expect(finalized.judgment.status).not.toBe('identifying')
    expect(finalized.judgment.judgmentOrigin).toBe('space-evidence-only')
  })
})

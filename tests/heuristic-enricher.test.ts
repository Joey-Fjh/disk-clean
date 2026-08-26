import { describe, expect, it } from 'vitest'
import { enrichItemsWithDetectionHeuristics } from '../src/main/rules/heuristic-enricher'
import type { DetectionHeuristic } from '../src/shared/rule-layer-types'
import { mapSpaceScanItem } from '../src/shared/candidate-model'

describe('enrichItemsWithDetectionHeuristics', () => {
  it('adds evidence without granting deletable permission', () => {
    const heuristics: DetectionHeuristic[] = [
      {
        id: 'heuristic-cache-dir',
        name: 'cache',
        globDirs: ['**/cache'],
        reason: 'cache-like'
      }
    ]

    const item = mapSpaceScanItem({
      id: '1',
      ruleId: '__analyzer__',
      ruleName: 'x',
      category: 'dangerous',
      contentType: 'large-dir',
      drive: 'C:',
      path: 'C:\\Users\\me\\App\\cache',
      size: 100,
      sizeIsEstimate: true,
      snapshotComplete: true,
      entryKind: 'directory',
      deletable: false,
      autoSelect: false,
      source: 'analyzer',
      discoverySources: ['space-scan'],
      evidence: [],
      judgment: { status: 'pending', source: 'none', confidence: 'unknown', basis: [] },
      selection: { selectable: false },
      suggestedAction: 'none'
    })

    const [enriched] = enrichItemsWithDetectionHeuristics([item], heuristics)
    expect(enriched.evidence.length).toBeGreaterThan(0)
    expect(enriched.deletable).toBe(false)
    expect(enriched.selection.selectable).toBe(false)
  })
})

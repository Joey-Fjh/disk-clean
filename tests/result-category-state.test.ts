import { describe, expect, it } from 'vitest'
import type { ScanItem } from '../src/shared/types'
import { normalizeCandidate } from '../src/shared/candidate-model'
import {
  ResultCategoryViewState,
  firstDisplayCategoryWithItems,
  resolveActiveResultCategory,
  type CleanupDisplayCategory
} from '../src/renderer/result-category-state'

function item(id: string, category: CleanupDisplayCategory): ScanItem {
  const legacyCategory =
    category === 'recommended-clean' ? 'safe' : category === 'caution-clean' ? 'recommended' : 'dangerous'
  return normalizeCandidate({
    id,
    ruleId: 'rule',
    ruleName: 'rule',
    category: legacyCategory,
    name: id,
    path: `C:\\${id}`,
    size: 100,
    drive: 'C:',
    contentType: 'system-temp',
    reason: '',
    impact: '',
    deletable: category === 'recommended-clean',
    autoSelect: false,
    snapshotComplete: true,
    sizeIsEstimate: true,
    entryKind: 'directory',
    source: 'rule',
    discoverySources: ['rule'],
    evidence: [],
    judgment: {
      status: category === 'recommended-clean' ? 'suggested' : 'caution',
      source: 'legacy-rule',
      confidence: 'high',
      basis: [],
      judgmentOrigin: 'local-rule'
    },
    selection: { selectable: category === 'recommended-clean' },
    suggestedAction: 'none'
  })
}

describe('result category view state', () => {
  it('uses firstCategoryWithItems when user has not selected a tab', () => {
    const items = [item('a', 'recommended-clean'), item('b', 'caution-clean')]
    expect(resolveActiveResultCategory(items, null)).toBe('recommended-clean')
    expect(firstDisplayCategoryWithItems(items)).toBe('recommended-clean')
  })

  it('keeps caution-clean after user selection across incremental batches', () => {
    const state = new ResultCategoryViewState()
    const safeOnly = [item('a', 'recommended-clean')]
    state.select('caution-clean')
    expect(state.resolveActiveCategory(safeOnly)).toBe('caution-clean')

    const mixed = [item('a', 'recommended-clean'), item('b', 'caution-clean')]
    expect(state.resolveActiveCategory(mixed)).toBe('caution-clean')
  })

  it('keeps space-occupancy after scan completes', () => {
    const state = new ResultCategoryViewState()
    state.select('space-occupancy')
    const finalItems = [item('a', 'recommended-clean'), item('b', 'space-occupancy')]
    expect(state.resolveActiveCategory(finalItems)).toBe('space-occupancy')
  })

  it('clears user selection when a new scan starts', () => {
    const state = new ResultCategoryViewState()
    state.select('space-occupancy')
    state.clear()
    const items = [item('a', 'recommended-clean')]
    expect(state.resolveActiveCategory(items)).toBe('recommended-clean')
    expect(state.hasUserSelection()).toBe(false)
  })
})

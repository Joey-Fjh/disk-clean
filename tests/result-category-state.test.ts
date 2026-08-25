import { describe, expect, it } from 'vitest'
import type { ScanItem } from '../src/shared/types'
import {
  ResultCategoryViewState,
  firstCategoryWithItems,
  resolveActiveResultCategory
} from '../src/renderer/result-category-state'

function item(id: string, category: ScanItem['category']): ScanItem {
  return {
    id,
    category,
    ruleName: 'rule',
    name: id,
    path: `C:\\${id}`,
    size: 100,
    drive: 'C:',
    contentType: 'system-temp',
    reason: '',
    impact: ''
  }
}

describe('result category view state', () => {
  it('uses firstCategoryWithItems when user has not selected a tab', () => {
    const items = [item('a', 'safe'), item('b', 'recommended')]
    expect(resolveActiveResultCategory(items, null)).toBe('safe')
    expect(firstCategoryWithItems(items)).toBe('safe')
  })

  it('keeps recommended after user selection across incremental batches', () => {
    const state = new ResultCategoryViewState()
    const safeOnly = [item('a', 'safe')]
    state.select('recommended')
    expect(state.resolveActiveCategory(safeOnly)).toBe('recommended')

    const mixed = [item('a', 'safe'), item('b', 'recommended')]
    expect(state.resolveActiveCategory(mixed)).toBe('recommended')
  })

  it('keeps dangerous after scan completes', () => {
    const state = new ResultCategoryViewState()
    state.select('dangerous')
    const finalItems = [item('a', 'safe'), item('b', 'dangerous')]
    expect(state.resolveActiveCategory(finalItems)).toBe('dangerous')
  })

  it('clears user selection when a new scan starts', () => {
    const state = new ResultCategoryViewState()
    state.select('dangerous')
    state.clear()
    const items = [item('a', 'safe')]
    expect(state.resolveActiveCategory(items)).toBe('safe')
    expect(state.hasUserSelection()).toBe(false)
  })
})

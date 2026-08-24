import { describe, expect, it } from 'vitest'
import { RuleGroupExpansionState } from '../src/renderer/rule-group-state'

describe('RuleGroupExpansionState', () => {
  it('expands only the first group by default', () => {
    const state = new RuleGroupExpansionState()

    expect(state.isExpanded('safe', 'Cursor 缓存', true)).toBe(true)
    expect(state.isExpanded('safe', 'Chrome 缓存', false)).toBe(false)
  })

  it('preserves explicit expand and collapse choices', () => {
    const state = new RuleGroupExpansionState()
    state.isExpanded('safe', 'Cursor 缓存', true)

    state.setExpanded('safe', 'Chrome 缓存', true)
    state.setExpanded('safe', 'Cursor 缓存', false)

    expect(state.isExpanded('safe', 'Cursor 缓存', true)).toBe(false)
    expect(state.isExpanded('safe', 'Chrome 缓存', false)).toBe(true)
  })

  it('clears state for a new scan', () => {
    const state = new RuleGroupExpansionState()
    state.isExpanded('safe', 'Cursor 缓存', true)
    state.setExpanded('safe', 'Chrome 缓存', true)

    state.clear()

    expect(state.isExpanded('safe', 'Cursor 缓存', true)).toBe(true)
    expect(state.isExpanded('safe', 'Chrome 缓存', false)).toBe(false)
  })
})

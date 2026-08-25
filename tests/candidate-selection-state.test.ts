import { describe, expect, it } from 'vitest'
import { CandidateSelectionViewState } from '../src/renderer/candidate-selection-state'

interface Item {
  id: string
  defaultChecked: boolean
}

function item(id: string, defaultChecked = false): Item {
  return { id, defaultChecked }
}

const getDefaultChecked = (candidate: Item): boolean => candidate.defaultChecked

describe('CandidateSelectionViewState', () => {
  it('applies default selection when user has not interacted', () => {
    const state = new CandidateSelectionViewState()
    state.reconcileFinalItems([item('a', true), item('b', false), item('c', true)], getDefaultChecked)
    expect([...state.getSelectedIds()].sort()).toEqual(['a', 'c'])
    expect(state.hasUserInteraction()).toBe(false)
  })

  it('keeps a single user-selected item after reconcile', () => {
    const state = new CandidateSelectionViewState()
    state.select('b')
    state.reconcileFinalItems([item('a', true), item('b', false), item('c', true)], getDefaultChecked)
    expect([...state.getSelectedIds()]).toEqual(['b'])
  })

  it('keeps empty selection when user explicitly cleared all checkboxes', () => {
    const state = new CandidateSelectionViewState()
    state.setMany(['a', 'b'], true)
    state.setMany(['a', 'b'], false)
    state.reconcileFinalItems([item('a', true), item('b', true)], getDefaultChecked)
    expect(state.getSelectedIds().size).toBe(0)
    expect(state.hasUserInteraction()).toBe(true)
  })

  it('does not auto-select new default candidates after user interaction', () => {
    const state = new CandidateSelectionViewState()
    state.select('a')
    state.reconcileFinalItems([item('a', false), item('b', true)], getDefaultChecked)
    expect([...state.getSelectedIds()]).toEqual(['a'])
  })

  it('removes stale ids that are no longer in the final result', () => {
    const state = new CandidateSelectionViewState()
    state.select('gone')
    state.select('stay')
    state.reconcileFinalItems([item('stay', false)], getDefaultChecked)
    expect([...state.getSelectedIds()]).toEqual(['stay'])
  })

  it('marks user interaction when selecting all or clearing all', () => {
    const selectAll = new CandidateSelectionViewState()
    selectAll.setMany(['a', 'b'], true)
    expect(selectAll.hasUserInteraction()).toBe(true)

    const clearAll = new CandidateSelectionViewState()
    clearAll.setMany(['a', 'b'], false)
    expect(clearAll.hasUserInteraction()).toBe(true)
  })

  it('marks user interaction on single checkbox select and deselect', () => {
    const state = new CandidateSelectionViewState()
    state.select('a')
    expect(state.hasUserInteraction()).toBe(true)

    const cleared = new CandidateSelectionViewState()
    cleared.select('a')
    cleared.deselect('a')
    expect(cleared.hasUserInteraction()).toBe(true)
  })

  it('resets touched flag and selection on clear', () => {
    const state = new CandidateSelectionViewState()
    state.select('a')
    state.clear()
    expect(state.getSelectedIds().size).toBe(0)
    expect(state.hasUserInteraction()).toBe(false)
  })
})

interface AgentItem {
  id: string
  defaultChecked: boolean
  selectable: boolean
}

function agentItem(id: string, defaultChecked: boolean, selectable: boolean): AgentItem {
  return { id, defaultChecked, selectable }
}

describe('CandidateSelectionViewState after agent update', () => {
  it('clears default-selected item when agent marks it keep', () => {
    const state = new CandidateSelectionViewState()
    state.reconcileFinalItems([agentItem('a', true, true)], (item) => item.defaultChecked)
    expect(state.isSelected('a')).toBe(true)

    state.reconcileAfterAgentUpdate(
      [agentItem('a', true, false)],
      (item) => item.selectable,
      (item) => item.defaultChecked
    )
    expect(state.isSelected('a')).toBe(false)
    expect(state.getSelectedIds().size).toBe(0)
  })

  it('keeps other legal selections when one item becomes uncertain', () => {
    const state = new CandidateSelectionViewState()
    state.setMany(['a', 'b'], true)
    state.reconcileAfterAgentUpdate(
      [agentItem('a', false, true), agentItem('b', false, false)],
      (item) => item.selectable,
      (item) => item.defaultChecked
    )
    expect([...state.getSelectedIds()]).toEqual(['a'])
  })

  it('does not select analyzer-only items even when agent suggests clean', () => {
    const state = new CandidateSelectionViewState()
    state.reconcileAfterAgentUpdate(
      [agentItem('space-only', true, false)],
      (item) => item.selectable,
      (item) => item.defaultChecked
    )
    expect(state.getSelectedIds().size).toBe(0)
  })

  it('preserves legal user selections after agent redraw', () => {
    const state = new CandidateSelectionViewState()
    state.select('b')
    state.reconcileAfterAgentUpdate(
      [agentItem('a', true, true), agentItem('b', false, true)],
      (item) => item.selectable,
      (item) => item.defaultChecked
    )
    expect([...state.getSelectedIds()]).toEqual(['b'])
  })
})

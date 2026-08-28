// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ScanItem } from '../src/shared/types'
import { normalizeCandidate } from '../src/shared/candidate-model'
import {
  CLEANUP_DISPLAY_CATEGORY_ORDER,
  type CleanupDisplayCategory
} from '../src/shared/cleanup-display-category'
import { ResultCategoryViewState } from '../src/renderer/result-category-state'
import { preservePanelScrollTop } from '../src/renderer/panel-scroll'

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
    deletable: false,
    autoSelect: false,
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
    selection: { selectable: false },
    suggestedAction: 'none'
  })
}

function renderCategoryTabs(items: ScanItem[], state: ResultCategoryViewState): HTMLElement {
  const active = state.resolveActiveCategory(items)
  const root = document.createElement('div')
  root.className = 'result-panel'

  const tabBar = document.createElement('nav')
  tabBar.className = 'category-tabs'

  const panels = document.createElement('div')
  panels.className = 'category-panels'

  for (const category of CLEANUP_DISPLAY_CATEGORY_ORDER) {
    const tab = document.createElement('button')
    tab.className = `category-tab${category === active ? ' active' : ''}`
    tab.dataset.category = category
    tabBar.appendChild(tab)

    const panel = document.createElement('section')
    panel.className = `category-panel${category === active ? ' active' : ''}`
    panel.id = `cat-panel-${category}`
    panels.appendChild(panel)
  }

  root.append(tabBar, panels)
  return root
}

function getActiveCategory(root: HTMLElement): CleanupDisplayCategory | null {
  const tab = root.querySelector<HTMLButtonElement>('.category-tab.active')
  return (tab?.dataset.category as CleanupDisplayCategory | undefined) ?? null
}

describe('result category DOM render', () => {
  it('keeps user-selected caution tab after incremental re-render', () => {
    const state = new ResultCategoryViewState()
    state.select('caution-clean')

    const first = renderCategoryTabs([item('a', 'recommended-clean')], state)
    expect(getActiveCategory(first)).toBe('caution-clean')

    const second = renderCategoryTabs(
      [item('a', 'recommended-clean'), item('b', 'caution-clean')],
      state
    )
    expect(getActiveCategory(second)).toBe('caution-clean')
  })

  it('defaults to first category with items when user has not chosen a tab', () => {
    const state = new ResultCategoryViewState()
    const root = renderCategoryTabs([item('a', 'caution-clean')], state)
    expect(getActiveCategory(root)).toBe('caution-clean')
  })

  it('preserves panel scrollTop across category re-render', () => {
    const panel = document.createElement('div')
    panel.id = 'panel-clean'
    panel.style.height = '100px'
    panel.style.overflow = 'auto'
    panel.innerHTML = '<div style="height:800px"></div>'
    document.body.appendChild(panel)
    panel.scrollTop = 160

    const state = new ResultCategoryViewState()
    state.select('space-occupancy')

    preservePanelScrollTop(panel, () => {
      panel.querySelector('#categories')?.remove()
      const mount = document.createElement('div')
      mount.id = 'categories'
      mount.appendChild(renderCategoryTabs([item('x', 'space-occupancy')], state))
      panel.insertBefore(mount, panel.firstChild)
    })

    expect(panel.scrollTop).toBe(160)
    panel.remove()
  })
})

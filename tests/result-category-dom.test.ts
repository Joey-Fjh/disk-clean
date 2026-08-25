// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Category, ScanItem } from '../src/shared/types'
import { CATEGORY_ORDER } from '../src/shared/types'
import { ResultCategoryViewState } from '../src/renderer/result-category-state'
import { preservePanelScrollTop } from '../src/renderer/panel-scroll'

function item(id: string, category: Category): ScanItem {
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

function renderCategoryTabs(items: ScanItem[], state: ResultCategoryViewState): HTMLElement {
  const active = state.resolveActiveCategory(items)
  const root = document.createElement('div')
  root.className = 'result-panel'

  const tabBar = document.createElement('nav')
  tabBar.className = 'category-tabs'

  const panels = document.createElement('div')
  panels.className = 'category-panels'

  for (const category of CATEGORY_ORDER) {
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

function getActiveCategory(root: HTMLElement): Category | null {
  const tab = root.querySelector<HTMLButtonElement>('.category-tab.active')
  return (tab?.dataset.category as Category | undefined) ?? null
}

describe('result category DOM render', () => {
  it('keeps user-selected caution tab after incremental re-render', () => {
    const state = new ResultCategoryViewState()
    state.select('recommended')

    const first = renderCategoryTabs([item('a', 'safe')], state)
    expect(getActiveCategory(first)).toBe('recommended')

    const second = renderCategoryTabs([item('a', 'safe'), item('b', 'recommended')], state)
    expect(getActiveCategory(second)).toBe('recommended')
  })

  it('defaults to first category with items when user has not chosen a tab', () => {
    const state = new ResultCategoryViewState()
    const root = renderCategoryTabs([item('a', 'recommended')], state)
    expect(getActiveCategory(root)).toBe('recommended')
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
    state.select('dangerous')

    preservePanelScrollTop(panel, () => {
      panel.querySelector('#categories')?.remove()
      const mount = document.createElement('div')
      mount.id = 'categories'
      mount.appendChild(renderCategoryTabs([item('x', 'dangerous')], state))
      panel.insertBefore(mount, panel.firstChild)
    })

    expect(panel.scrollTop).toBe(160)
    panel.remove()
  })
})

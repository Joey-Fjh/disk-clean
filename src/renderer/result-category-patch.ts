import {
  groupItemsByDisplayCategory,
  type CleanupDisplayCategory
} from '../shared/cleanup-display-category'
import type { ScanItem } from '../shared/types'
import { CLEANUP_DISPLAY_CATEGORY_ORDER } from './result-category-state'
import { computeScanItemRenderRevision } from './scan-item-render-revision'

export function buildResultStructureKey(
  items: ScanItem[],
  options: { agentReviewing: boolean }
): string {
  const grouped = groupItemsByDisplayCategory(items, { agentReviewing: options.agentReviewing })
  return CLEANUP_DISPLAY_CATEGORY_ORDER.map((category) => {
    const catItems = grouped[category] ?? []
    const rules = [...new Set(catItems.map((item) => item.ruleName))].sort()
    return `${category}=${rules.join(',')}`
  }).join('|')
}

function upsertListItem(
  list: Element,
  item: ScanItem,
  createListItem: (item: ScanItem) => HTMLLIElement
): void {
  const revision = computeScanItemRenderRevision(item)
  const selector = `[data-item-id="${cssEscape(item.id)}"]`
  const existing = list.querySelector<HTMLElement>(selector)
  if (existing) {
    if (existing.getAttribute('data-render-revision') === revision) return
    const replacement = createListItem(item)
    replacement.dataset.itemId = item.id
    replacement.dataset.renderRevision = revision
    existing.replaceWith(replacement)
    return
  }
  const li = createListItem(item)
  li.dataset.itemId = item.id
  li.dataset.renderRevision = revision
  list.appendChild(li)
}

export function patchResultCategoriesDom(
  panel: HTMLElement,
  items: ScanItem[],
  options: {
    agentReviewing: boolean
    formatSize: (bytes: number) => string
    createListItem: (item: ScanItem) => HTMLLIElement
  }
): boolean {
  const grouped = groupItemsByDisplayCategory(items, { agentReviewing: options.agentReviewing })
  const incomingIds = new Set(items.map((item) => item.id))

  for (const category of CLEANUP_DISPLAY_CATEGORY_ORDER) {
    const catItems = grouped[category] ?? []
    const tab = panel.querySelector<HTMLButtonElement>(`.category-tab[data-category="${category}"]`)
    if (!tab) {
      if (catItems.length > 0) return false
      continue
    }
    const catSize = catItems.reduce((sum, item) => sum + item.size, 0)
    const meta = tab.querySelector('.category-tab-meta')
    if (meta) {
      meta.textContent = `${catItems.length} 项 · ${options.formatSize(catSize)}`
    }

    const catPanel = panel.querySelector<HTMLElement>(`#cat-panel-${category}`)
    if (!catPanel) {
      if (catItems.length > 0) return false
      continue
    }

    if (catItems.length === 0) continue

    for (const [ruleName, ruleItems] of groupByRule(catItems)) {
      const ruleSize = ruleItems.reduce((sum, item) => sum + item.size, 0)
      const group = catPanel.querySelector<HTMLElement>(
        `.rule-group[data-rule-name="${cssEscape(ruleName)}"]`
      )
      if (!group) return false

      const metaSpan = group.querySelector('.rule-group-meta')
      if (metaSpan) {
        const drives = [...new Set(ruleItems.map((item) => item.drive))].join('、')
        metaSpan.textContent = `${ruleItems.length} 项 · ${options.formatSize(ruleSize)} · ${drives}`
      }

      const list = group.querySelector('ul.item-list')
      if (!list) return false

      for (const item of ruleItems) {
        upsertListItem(list, item, options.createListItem)
      }

      for (const row of [...list.querySelectorAll<HTMLElement>('[data-item-id]')]) {
        const id = row.getAttribute('data-item-id')
        if (id && !incomingIds.has(id)) row.remove()
      }
    }
  }

  for (const row of [...panel.querySelectorAll<HTMLElement>('[data-item-id]')]) {
    const id = row.getAttribute('data-item-id')
    if (id && !incomingIds.has(id)) row.remove()
  }

  const renderedIds = new Set(
    [...panel.querySelectorAll('[data-item-id]')].map((el) => el.getAttribute('data-item-id') ?? '')
  )
  if (renderedIds.size !== incomingIds.size) return false
  for (const id of incomingIds) {
    if (!renderedIds.has(id)) return false
  }

  const idCounts = new Map<string, number>()
  for (const row of panel.querySelectorAll('[data-item-id]')) {
    const id = row.getAttribute('data-item-id') ?? ''
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }
  for (const count of idCounts.values()) {
    if (count !== 1) return false
  }

  return true
}

function groupByRule(items: ScanItem[]): Map<string, ScanItem[]> {
  const groups = new Map<string, ScanItem[]>()
  for (const item of items) {
    const list = groups.get(item.ruleName) ?? []
    list.push(item)
    groups.set(item.ruleName, list)
  }
  return groups
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

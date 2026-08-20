/// <reference path="../preload/index.d.ts" />
import type { Category, RuleWithMeta, ScanItem, ScanMode, ScanResult } from '../shared/types'
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CONTENT_TYPE_LABELS,
  SCAN_MODE_LABELS
} from '../shared/types'

type ThemeMode = 'light' | 'dark' | 'system'

// ── Tab navigation ──
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab')
const panels = document.querySelectorAll<HTMLElement>('.tab-panel')

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab!
    tabs.forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === target)
      t.setAttribute('aria-selected', String(t.dataset.tab === target))
    })
    panels.forEach((p) => {
      p.classList.toggle('active', p.id === `panel-${target}`)
    })
  })
})

// ── Theme ──
const themeControl = document.getElementById('theme-control')!
const themeButtons = themeControl.querySelectorAll<HTMLButtonElement>('.segment')

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function applyTheme(mode: ThemeMode): void {
  localStorage.setItem('theme', mode)
  document.documentElement.setAttribute('data-theme', resolveTheme(mode))
  themeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === mode)
  })
}

const savedTheme = (localStorage.getItem('theme') as ThemeMode) || 'system'
applyTheme(savedTheme)

themeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    applyTheme(btn.dataset.theme as ThemeMode)
  })
})

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const current = (localStorage.getItem('theme') as ThemeMode) || 'system'
  if (current === 'system') applyTheme('system')
})

// ── Scan / Clean ──
const quickScanBtn = document.getElementById('quick-scan-btn') as HTMLButtonElement
const fullScanBtn = document.getElementById('full-scan-btn') as HTMLButtonElement
const cleanBtn = document.getElementById('clean-btn') as HTMLButtonElement
const summary = document.getElementById('summary') as HTMLElement
const progress = document.getElementById('progress') as HTMLElement
const progressFill = document.getElementById('progress-fill') as HTMLElement
const progressLabel = document.getElementById('progress-label') as HTMLElement
const progressRule = document.getElementById('progress-rule') as HTMLElement
const progressHint = document.getElementById('progress-hint') as HTMLElement
const categoriesEl = document.getElementById('categories') as HTMLElement
const totalSizeEl = document.getElementById('total-size') as HTMLElement
const itemCountEl = document.getElementById('item-count') as HTMLElement
const selectedSizeEl = document.getElementById('selected-size') as HTMLElement
const totalSizeLabelEl = document.getElementById('total-size-label') as HTMLElement
const statusText = document.getElementById('status-text') as HTMLElement

let scanResult: ScanResult | null = null
let currentScanMode: ScanMode = 'quick'
let selectedIds = new Set<string>()

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function categoryBadgeClass(category: Category): string {
  if (category === 'safe') return 'badge-safe'
  if (category === 'recommended') return 'badge-recommended'
  return 'badge-dangerous'
}

function updateProgressUI(p: {
  mode: ScanMode
  label: string
  ruleName?: string
  category: Category
  current: number
  total: number
  categoryCurrent: number
  categoryTotal: number
}): void {
  const modeLabel = SCAN_MODE_LABELS[p.mode]
  const unit = p.mode === 'quick' ? '条规则' : '个目录'
  progressLabel.textContent = `${modeLabel} · 第 ${p.current}/${p.total} ${unit}`
  progressRule.textContent = p.label || p.ruleName || '…'
  progressHint.textContent =
    p.mode === 'full'
      ? '分析磁盘空间占用，不判断是否为垃圾'
      : `${CATEGORY_LABELS[p.category]} · 本档 ${p.categoryCurrent}/${p.categoryTotal}`

  const percent = p.total > 0 ? Math.min((p.current / p.total) * 100, 95) : 0
  progressFill.style.width = `${percent}%`
}

function getDefaultChecked(item: ScanItem): boolean {
  if (!item.deletable) return false
  if (item.category === 'safe') return true
  return false
}

function updateSelectedSummary(): void {
  if (!scanResult) return
  const selected = scanResult.items.filter((i) => selectedIds.has(i.id))
  const size = selected.reduce((s, i) => s + i.size, 0)
  selectedSizeEl.textContent = formatSize(size)
  cleanBtn.disabled = selected.length === 0
}

function renderCategories(items: ScanItem[]): void {
  categoriesEl.innerHTML = ''
  if (items.length === 0) {
    categoriesEl.innerHTML = `
      <section class="empty-state">
        <div class="empty-icon">✓</div>
        <h3>未发现可清理项</h3>
        <p>当前规则下没有扫描到可清理内容，或相关目录为空</p>
      </section>
    `
    return
  }

  const order = CATEGORY_ORDER
  const grouped = Object.fromEntries(
    order.map((cat) => [cat, items.filter((i) => i.category === cat)])
  ) as Record<Category, ScanItem[]>

  const firstWithItems = order.find((cat) => grouped[cat].length > 0) ?? 'safe'

  const wrapper = document.createElement('div')
  wrapper.className = 'result-panel'

  const tabBar = document.createElement('nav')
  tabBar.className = 'category-tabs'
  tabBar.setAttribute('role', 'tablist')

  const panels = document.createElement('div')
  panels.className = 'category-panels'

  function getDeletableItems(catItems: ScanItem[]): ScanItem[] {
    return catItems.filter((item) => item.deletable)
  }

  function updateSelectAllState(selectAllCb: HTMLInputElement, catItems: ScanItem[]): void {
    const deletable = getDeletableItems(catItems)
    const selectedCount = deletable.filter((item) => selectedIds.has(item.id)).length
    selectAllCb.checked = selectedCount > 0 && selectedCount === deletable.length
    selectAllCb.indeterminate = selectedCount > 0 && selectedCount < deletable.length
  }

  function setListSelection(
    list: HTMLElement,
    catItems: ScanItem[],
    selected: boolean,
    selectAllCb: HTMLInputElement
  ): void {
    for (const item of getDeletableItems(catItems)) {
      if (selected) selectedIds.add(item.id)
      else selectedIds.delete(item.id)
    }
    list.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not(:disabled)').forEach((cb) => {
      cb.checked = selected
    })
    updateSelectAllState(selectAllCb, catItems)
    updateSelectedSummary()
  }

  function renderItemList(catItems: ScanItem[], selectAllCb: HTMLInputElement): HTMLElement {
    const list = document.createElement('ul')
    list.className = 'item-list scroll-area'

    for (const item of catItems) {
      const li = document.createElement('li')
      li.className = 'item'

      const checked = selectedIds.has(item.id)
      const disabled = !item.deletable

      li.innerHTML = `
        <input type="checkbox" data-id="${item.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        <div class="item-info">
          <div class="item-name">${item.ruleName}</div>
          <div class="item-type">${CONTENT_TYPE_LABELS[item.contentType]}</div>
          <button type="button" class="item-path" title="在资源管理器中打开">${item.path}</button>
          ${item.reason ? `<div class="item-desc">${item.reason}</div>` : ''}
          ${item.impact ? `<div class="item-impact">${item.impact}</div>` : ''}
          ${item.description && item.description !== item.reason ? `<div class="item-note">${item.description}</div>` : ''}
        </div>
        <span class="item-size">${formatSize(item.size)}</span>
      `

      const checkbox = li.querySelector('input') as HTMLInputElement
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedIds.add(item.id)
        else selectedIds.delete(item.id)
        updateSelectAllState(selectAllCb, catItems)
        updateSelectedSummary()
      })

      const pathBtn = li.querySelector('.item-path') as HTMLButtonElement
      pathBtn.addEventListener('click', async () => {
        try {
          await window.diskClean.openInExplorer(item.path)
        } catch (err) {
          statusText.textContent = `无法打开：${err instanceof Error ? err.message : String(err)}`
        }
      })

      list.appendChild(li)
    }
    return list
  }

  function switchCategory(category: Category): void {
    tabBar.querySelectorAll('.category-tab').forEach((btn) => {
      const el = btn as HTMLButtonElement
      const active = el.dataset.category === category
      el.classList.toggle('active', active)
      el.setAttribute('aria-selected', String(active))
    })
    panels.querySelectorAll('.category-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `cat-panel-${category}`)
    })
  }

  for (const category of order) {
    const catItems = grouped[category]
    const catSize = catItems.reduce((s, i) => s + i.size, 0)
    const badgeClass =
      category === 'safe' ? 'badge-safe' : category === 'recommended' ? 'badge-recommended' : 'badge-dangerous'

    const tab = document.createElement('button')
    tab.className = `category-tab${category === firstWithItems ? ' active' : ''}`
    tab.dataset.category = category
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(category === firstWithItems))
    tab.innerHTML = `
      <span class="category-tab-label">${CATEGORY_LABELS[category]}</span>
      <span class="category-tab-meta">${catItems.length} 项 · ${formatSize(catSize)}</span>
    `
    tab.addEventListener('click', () => switchCategory(category))
    tabBar.appendChild(tab)

    const panel = document.createElement('section')
    panel.className = `category-panel${category === firstWithItems ? ' active' : ''}`
    panel.id = `cat-panel-${category}`
    panel.setAttribute('role', 'tabpanel')

    panel.innerHTML = `
      <div class="category-panel-header">
        <div class="category-panel-title">
          <span class="category-badge ${badgeClass}">${CATEGORY_LABELS[category]}</span>
          <p class="category-desc">${CATEGORY_DESCRIPTIONS[category]}</p>
        </div>
      </div>
    `

    if (catItems.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty-category'
      empty.textContent = '未发现可清理项'
      panel.appendChild(empty)
    } else {
      const deletableCount = catItems.filter((i) => i.deletable).length
      if (deletableCount > 0) {
        const header = panel.querySelector('.category-panel-header')!
        const selectAllLabel = document.createElement('label')
        selectAllLabel.className = 'select-all'
        const selectAllCb = document.createElement('input')
        selectAllCb.type = 'checkbox'
        selectAllCb.className = 'select-all-checkbox'
        selectAllLabel.append(selectAllCb, document.createTextNode('全选'))

        const list = renderItemList(catItems, selectAllCb)
        updateSelectAllState(selectAllCb, catItems)

        selectAllCb.addEventListener('change', () => {
          setListSelection(list, catItems, selectAllCb.checked, selectAllCb)
        })

        header.appendChild(selectAllLabel)
        panel.appendChild(list)
      } else {
        panel.appendChild(renderItemList(catItems, document.createElement('input')))
      }
    }

    panels.appendChild(panel)
  }

  wrapper.appendChild(tabBar)
  wrapper.appendChild(panels)
  categoriesEl.appendChild(wrapper)
}

async function startScan(mode: ScanMode = currentScanMode): Promise<void> {
  currentScanMode = mode
  quickScanBtn.disabled = true
  fullScanBtn.disabled = true
  cleanBtn.disabled = true
  progress.hidden = false
  summary.hidden = true
  categoriesEl.innerHTML = `<section class="empty-state"><p>${SCAN_MODE_LABELS[mode]}中…</p></section>`
  progressFill.style.width = '0%'
  progressRule.textContent = '准备开始…'
  progressLabel.textContent = `${SCAN_MODE_LABELS[mode]} · 初始化`
  progressHint.textContent = mode === 'full' ? '正在分析本机各磁盘目录占用' : ''
  statusText.textContent = `${SCAN_MODE_LABELS[mode]}中，请稍候`

  const unsubscribe = window.diskClean.onScanProgress((p) => {
    if (p.status === 'scanning') {
      updateProgressUI(p)
    }
  })

  try {
    const result = await window.diskClean.startScan(mode)
    scanResult = result
    selectedIds = new Set(
      result.items.filter((i) => getDefaultChecked(i)).map((i) => i.id)
    )

    progressFill.style.width = '100%'
    progressRule.textContent = '扫描完成'
    progressLabel.textContent = `${SCAN_MODE_LABELS[mode]}完成 · 共 ${result.items.length} 项`
    progressHint.textContent = ''
    progress.hidden = true
    summary.hidden = false

    const deletableSize = result.items
      .filter((i) => i.deletable)
      .reduce((s, i) => s + i.size, 0)

    totalSizeLabelEl.textContent = mode === 'full' ? '分析总量' : '可清理总量'
    totalSizeEl.textContent = formatSize(mode === 'full' ? result.totalSize : deletableSize)
    itemCountEl.textContent = String(result.items.length)

    renderCategories(result.items)
    updateSelectedSummary()

    const errCount = result.errors.length
    statusText.textContent =
      errCount > 0
        ? `${SCAN_MODE_LABELS[mode]}完成，${errCount} 个路径因权限等原因跳过`
        : `${SCAN_MODE_LABELS[mode]}完成 · ${new Date(result.scannedAt).toLocaleString('zh-CN')}`
  } catch (err) {
    statusText.textContent = `扫描失败：${err instanceof Error ? err.message : String(err)}`
    progress.hidden = true
  } finally {
    unsubscribe()
    quickScanBtn.disabled = false
    fullScanBtn.disabled = false
  }
}

async function cleanSelected(): Promise<void> {
  if (!scanResult) return

  const selected = scanResult.items.filter((i) => selectedIds.has(i.id) && i.deletable)
  if (selected.length === 0) return

  const totalSize = selected.reduce((s, i) => s + i.size, 0)
  const riskLines = CATEGORY_ORDER.map((cat) => {
    const count = selected.filter((i) => i.category === cat).length
    return count > 0 ? `${CATEGORY_LABELS[cat]} ${count} 项` : null
  })
    .filter(Boolean)
    .join(' · ')

  const confirmed = confirm(
    `确认清理 ${selected.length} 项（预计释放 ${formatSize(totalSize)}）？\n\n${riskLines}\n\n将移入回收站，可从回收站恢复。`
  )
  if (!confirmed) return

  cleanBtn.disabled = true
  statusText.textContent = '正在生成清理计划并校验…'

  const result = await window.diskClean.executeCleanup({
    items: selected.map((item) => ({
      id: item.id,
      ruleId: item.ruleId,
      path: item.path,
      size: item.size,
      category: item.category,
      deletable: item.deletable
    }))
  })

  const parts = [`释放约 ${formatSize(result.freedBytes)}`, `成功 ${result.deleted}`]
  if (result.skipped > 0) parts.push(`跳过 ${result.skipped}`)
  if (result.failed > 0) parts.push(`失败 ${result.failed}`)
  statusText.textContent = `清理完成：${parts.join('，')}`

  await startScan(currentScanMode)
}

quickScanBtn.addEventListener('click', () => startScan('quick'))
fullScanBtn.addEventListener('click', () => startScan('full'))
cleanBtn.addEventListener('click', cleanSelected)

// ── Rules settings ──
const rulesList = document.getElementById('rules-list') as HTMLElement
const rulesFilter = document.getElementById('rules-filter') as HTMLSelectElement
const rulesStatus = document.getElementById('rules-status') as HTMLElement
const importRulesBtn = document.getElementById('import-rules-btn') as HTMLButtonElement
const resetRulesBtn = document.getElementById('reset-rules-btn') as HTMLButtonElement

let allRules: RuleWithMeta[] = []

function renderRulesList(): void {
  const filter = rulesFilter.value
  const order = CATEGORY_ORDER
  const filtered = allRules.filter((rule) => filter === 'all' || rule.category === filter)

  rulesList.innerHTML = ''
  if (filtered.length === 0) {
    rulesList.innerHTML = '<div class="rules-empty">没有匹配的规则</div>'
    return
  }

  const groups =
    filter === 'all'
      ? order
          .map((cat) => ({
            category: cat,
            rules: filtered.filter((r) => r.category === cat)
          }))
          .filter((g) => g.rules.length > 0)
      : [{ category: filter as Category, rules: filtered }]

  for (const group of groups) {
    if (filter === 'all') {
      const title = document.createElement('div')
      title.className = 'rules-group-title'
      title.textContent = CATEGORY_LABELS[group.category]
      rulesList.appendChild(title)
    }

    for (const rule of group.rules) {
      const row = document.createElement('div')
      row.className = `rule-item${rule.enabled ? '' : ' disabled'}`

      row.innerHTML = `
        <div class="rule-item-main">
          <div class="rule-item-name">${rule.name}</div>
          <div class="rule-item-meta">${rule.contentType ? CONTENT_TYPE_LABELS[rule.contentType] + ' · ' : ''}${rule.id}${rule.source === 'custom' ? ' · 自定义' : ''}</div>
        </div>
        <div class="rule-item-actions">
          <label class="rule-toggle">
            <input type="checkbox" ${rule.enabled ? 'checked' : ''} />
            <span></span>
          </label>
          ${rule.source === 'custom' ? '<button class="rule-delete">删除</button>' : ''}
        </div>
      `

      const toggle = row.querySelector('input') as HTMLInputElement
      toggle.addEventListener('change', async () => {
        allRules = await window.diskClean.setRuleEnabled(rule.id, toggle.checked)
        renderRulesList()
        rulesStatus.textContent = toggle.checked ? `已启用：${rule.name}` : `已禁用：${rule.name}`
      })

      const deleteBtn = row.querySelector('.rule-delete') as HTMLButtonElement | null
      deleteBtn?.addEventListener('click', async () => {
        if (!confirm(`确认删除自定义规则「${rule.name}」？`)) return
        const result = await window.diskClean.removeRule(rule.id)
        allRules = result.rules
        renderRulesList()
        rulesStatus.textContent = result.removed ? `已删除：${rule.name}` : '删除失败'
      })

      rulesList.appendChild(row)
    }
  }

  const enabled = allRules.filter((r) => r.enabled).length
  rulesStatus.textContent = `共 ${allRules.length} 条规则，已启用 ${enabled} 条`
}

async function loadRulesSettings(): Promise<void> {
  allRules = await window.diskClean.listRules()
  renderRulesList()
}

rulesFilter.addEventListener('change', renderRulesList)

importRulesBtn.addEventListener('click', async () => {
  const result = await window.diskClean.importRules()
  allRules = result.rules
  renderRulesList()
  rulesStatus.textContent =
    result.imported > 0 ? `成功导入 ${result.imported} 条规则` : '未导入任何规则'
})

resetRulesBtn.addEventListener('click', async () => {
  if (!confirm('确认恢复默认规则？将清除所有自定义规则和禁用设置。')) return
  allRules = await window.diskClean.resetRules()
  renderRulesList()
  rulesStatus.textContent = '已恢复默认规则'
})

void loadRulesSettings()

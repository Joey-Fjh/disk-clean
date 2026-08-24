/// <reference path="../preload/index.d.ts" />
import type { Category, RuleWithMeta, ScanError, ScanItem, ScanResult } from '../shared/types'
import {
  CANDIDATE_TAB_LABELS,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_ORDER,
  CONTENT_TYPE_LABELS,
  RULE_CATEGORY_LABELS,
  SCAN_PHASE_LABELS
} from '../shared/types'
import { showConfirmDialog } from './confirm-dialog'
import { upsertScanItems } from '../shared/scan-item-accumulator'
import { normalizeCandidate } from '../shared/candidate-model'
import { RuleGroupExpansionState } from './rule-group-state'
import { buildScanItemRenderInput } from './candidate-render'
import { createScanItemElement } from './safe-render'

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
const driveSelect = document.getElementById('drive-select') as HTMLSelectElement
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement
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
let selectedIds = new Set<string>()
let scanning = false
let renderTimer: number | null = null
const ruleGroupExpansion = new RuleGroupExpansionState()

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
  label: string
  ruleName?: string
  category: Category
  phase?: 'space-discovery' | 'rule-identification'
  current: number
  total: number
  categoryCurrent: number
  categoryTotal: number
}): void {
  const phaseLabel = p.phase ? SCAN_PHASE_LABELS[p.phase] : '扫描'
  progressLabel.textContent = `正在扫描 · ${phaseLabel}`

  if (p.phase === 'space-discovery') {
    progressRule.textContent = p.label || '…'
    progressHint.textContent = `空间发现 · ${p.current}/${p.total}`
  } else {
    progressRule.textContent = p.label || p.ruleName || '…'
    progressHint.textContent = `${RULE_CATEGORY_LABELS[p.category]} · 本档 ${p.categoryCurrent}/${p.categoryTotal}`
  }

  const percent = p.total > 0 ? Math.min((p.current / p.total) * 100, 95) : 0
  progressFill.style.width = `${percent}%`
}

function isSelectable(item: ScanItem): boolean {
  const normalized = normalizeCandidate(item)
  return normalized.selection.selectable
}

function updateLiveSummary(items: ScanItem[]): void {
  const deletableSize = items.filter((i) => isSelectable(i)).reduce((s, i) => s + i.size, 0)
  totalSizeEl.textContent = formatSize(deletableSize)
  itemCountEl.textContent = String(items.length)
}

function scheduleRender(items: ScanItem[]): void {
  if (renderTimer !== null) window.clearTimeout(renderTimer)
  renderTimer = window.setTimeout(() => {
    renderCategories(items)
    renderTimer = null
  }, 120)
}

function setScanning(active: boolean): void {
  scanning = active
  scanBtn.textContent = active ? '停止扫描' : '开始扫描'
  scanBtn.classList.toggle('btn-primary', !active)
  scanBtn.classList.toggle('btn-stop', active)
  driveSelect.disabled = active
  if (active) {
    cleanBtn.disabled = true
  } else {
    updateSelectedSummary()
  }
}

function finishScan(result: ScanResult): void {
  scanResult = result
  const { items, errors, cancelled, drive } = result

  selectedIds = new Set(items.filter((i) => getDefaultChecked(i)).map((i) => i.id))

  progress.hidden = true
  updateLiveSummary(items)
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer)
    renderTimer = null
  }
  renderCategories(items)
  updateSelectedSummary()

  const driveLabel = drive === 'all' ? '全部磁盘' : `${drive} 盘`
  if (cancelled) {
    statusText.textContent = `${driveLabel} · 扫描已停止 · 保留 ${items.length} 项结果`
  } else if (errors.length > 0) {
    statusText.textContent = `${driveLabel} · 扫描完成，${errors.length} 个路径因权限等原因跳过`
  } else {
    statusText.textContent = `${driveLabel} · 扫描完成 · ${new Date(result.scannedAt).toLocaleString('zh-CN')}`
  }
}

function getDefaultChecked(item: ScanItem): boolean {
  const normalized = normalizeCandidate(item)
  return normalized.selection.selectable && normalized.autoSelect
}

function renderScanItemElement(item: ScanItem): HTMLLIElement {
  return createScanItemElement(
    buildScanItemRenderInput(item, {
      contentTypeLabel: CONTENT_TYPE_LABELS[item.contentType]
    })
  )
}

function updateSelectedSummary(): void {
  if (!scanResult) {
    cleanBtn.disabled = true
    return
  }
  const selected = scanResult.items.filter((i) => selectedIds.has(i.id))
  const size = selected.reduce((s, i) => s + i.size, 0)
  selectedSizeEl.textContent = formatSize(size)
  cleanBtn.disabled = scanning || selected.length === 0
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
    return catItems.filter((item) => isSelectable(item))
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

  function renderItemList(
    category: Category,
    catItems: ScanItem[],
    selectAllCb: HTMLInputElement
  ): HTMLElement {
    const container = document.createElement('div')
    container.className = 'rule-groups'

    const groups = new Map<string, ScanItem[]>()
    for (const item of catItems) {
      const list = groups.get(item.ruleName) ?? []
      list.push(item)
      groups.set(item.ruleName, list)
    }

    let groupIndex = 0
    for (const [ruleName, ruleItems] of groups) {
      const isFirstInCategory = groupIndex === 0
      groupIndex += 1
      const isExpanded = ruleGroupExpansion.isExpanded(category, ruleName, isFirstInCategory)

      const group = document.createElement('section')
      group.className = `rule-group${isExpanded ? ' is-expanded' : ' is-collapsed'}`

      const ruleSize = ruleItems.reduce((s, i) => s + i.size, 0)
      const drives = [...new Set(ruleItems.map((i) => i.drive))].join('、')

      const header = document.createElement('button')
      header.type = 'button'
      header.className = 'rule-group-header'
      header.setAttribute('aria-expanded', String(isExpanded))
      const chevron = document.createElement('span')
      chevron.className = 'rule-group-chevron'
      chevron.setAttribute('aria-hidden', 'true')
      const nameSpan = document.createElement('span')
      nameSpan.className = 'rule-group-name'
      nameSpan.textContent = ruleName
      nameSpan.title = ruleName
      const metaSpan = document.createElement('span')
      metaSpan.className = 'rule-group-meta'
      metaSpan.textContent = `${ruleItems.length} 项 · ${formatSize(ruleSize)} · ${drives}`
      header.append(chevron, nameSpan, metaSpan)

      header.addEventListener('click', () => {
        const nextExpanded = !group.classList.contains('is-expanded')
        group.classList.toggle('is-expanded', nextExpanded)
        group.classList.toggle('is-collapsed', !nextExpanded)
        header.setAttribute('aria-expanded', String(nextExpanded))
        ruleGroupExpansion.setExpanded(category, ruleName, nextExpanded)
      })

      group.appendChild(header)

      const body = document.createElement('div')
      body.className = 'rule-group-body'

      const list = document.createElement('ul')
      list.className = 'item-list'

      for (const item of ruleItems) {
        const normalized = normalizeCandidate(item)
        const li = renderScanItemElement(item)

        const checkbox = li.querySelector('input') as HTMLInputElement
        checkbox.dataset.id = item.id
        checkbox.checked = selectedIds.has(item.id)
        checkbox.disabled = !normalized.selection.selectable
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedIds.add(item.id)
          else selectedIds.delete(item.id)
          updateSelectAllState(selectAllCb, catItems)
          updateSelectedSummary()
        })

        const pathBtnEl = li.querySelector('.item-path') as HTMLButtonElement
        pathBtnEl.addEventListener('click', async () => {
          try {
            await window.diskClean.openInExplorer(item.path)
          } catch (err) {
            statusText.textContent = `无法打开：${err instanceof Error ? err.message : String(err)}`
          }
        })

        list.appendChild(li)
      }

      body.appendChild(list)
      group.appendChild(body)
      container.appendChild(group)
    }

    return container
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
      <span class="category-tab-label">${CANDIDATE_TAB_LABELS[category]}</span>
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
          <span class="category-badge ${badgeClass}">${CANDIDATE_TAB_LABELS[category]}</span>
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
      const deletableCount = catItems.filter((i) => isSelectable(i)).length
      if (deletableCount > 0) {
        const header = panel.querySelector('.category-panel-header')!
        const selectAllLabel = document.createElement('label')
        selectAllLabel.className = 'select-all'
        const selectAllCb = document.createElement('input')
        selectAllCb.type = 'checkbox'
        selectAllCb.className = 'select-all-checkbox'
        selectAllLabel.append(selectAllCb, document.createTextNode('全选'))

        const list = renderItemList(category, catItems, selectAllCb)
        list.classList.add('scroll-area')
        updateSelectAllState(selectAllCb, catItems)

        selectAllCb.addEventListener('change', () => {
          setListSelection(list, catItems, selectAllCb.checked, selectAllCb)
        })

        header.appendChild(selectAllLabel)
        panel.appendChild(list)
      } else {
        const list = renderItemList(category, catItems, document.createElement('input'))
        list.classList.add('scroll-area')
        panel.appendChild(list)
      }
    }

    panels.appendChild(panel)
  }

  wrapper.appendChild(tabBar)
  wrapper.appendChild(panels)
  categoriesEl.appendChild(wrapper)
}

async function startScan(): Promise<void> {
  const drive = driveSelect.value || 'all'
  setScanning(true)
  selectedIds = new Set()
  ruleGroupExpansion.clear()
  scanResult = null
  progress.hidden = false
  summary.hidden = false
  categoriesEl.innerHTML = ''
  progressFill.style.width = '0%'
  progressRule.textContent = '准备开始…'
  progressLabel.textContent = '正在扫描 · 空间发现'
  progressHint.textContent = `${drive === 'all' ? '全部磁盘' : `${drive} 盘`} · 统一扫描`
  statusText.textContent = '扫描中，发现的项目将实时列出…'

  let accumulatedItems: ScanItem[] = []
  let accumulatedErrors: ScanError[] = []
  updateLiveSummary(accumulatedItems)

  const unsubscribeProgress = window.diskClean.onScanProgress((p) => {
    if (p.status === 'scanning') updateProgressUI(p)
  })

  const unsubscribeItems = window.diskClean.onScanItems((batch) => {
    accumulatedItems = upsertScanItems(accumulatedItems, batch).items
    updateLiveSummary(accumulatedItems)
    scheduleRender(accumulatedItems)
  })

  try {
    const result = await window.diskClean.startScan({ drive })
    finishScan(result)
  } catch (err) {
    statusText.textContent = `扫描失败：${err instanceof Error ? err.message : String(err)}`
    progress.hidden = true
  } finally {
    unsubscribeProgress()
    unsubscribeItems()
    setScanning(false)
  }
}

async function handleScanButtonClick(): Promise<void> {
  if (scanning) {
    statusText.textContent = '正在停止扫描…'
    await window.diskClean.cancelScan()
    return
  }
  await startScan()
}

async function cleanSelected(): Promise<void> {
  if (!scanResult?.sessionId) return

  const selected = scanResult.items.filter((i) => selectedIds.has(i.id) && isSelectable(i))
  if (selected.length === 0) return

  const totalSize = selected.reduce((s, i) => s + i.size, 0)
  const riskLines = CATEGORY_ORDER.map((cat) => {
    const count = selected.filter((i) => i.category === cat).length
    return count > 0 ? `${CANDIDATE_TAB_LABELS[cat]} ${count} 项` : null
  })
    .filter(Boolean)
    .join(' · ')

  const confirmed = await showConfirmDialog({
    title: '确认清理',
    message: `将 ${selected.length} 项移入回收站（逻辑大小估算 ${formatSize(totalSize)}）`,
    details: [
      riskLines,
      '执行方式：移入 Windows 回收站',
      '这些文件仍可能占用磁盘空间，清空回收站后才会真正释放',
      '若路径自扫描后发生显著变化，将自动跳过而不强制执行'
    ]
  })
  if (!confirmed) return

  cleanBtn.disabled = true
  statusText.textContent = '正在生成清理计划并校验…'

  try {
    const result = await window.diskClean.executeCleanup({
      sessionId: scanResult.sessionId,
      candidateIds: selected.map((item) => item.id)
    })

    const parts = [
      `已移入回收站 ${formatSize(result.movedToTrashBytes)}（逻辑大小估算）`,
      `成功 ${result.moved}`,
      '清空回收站后才会真正释放磁盘空间'
    ]
    if (result.skipped > 0) parts.push(`校验跳过 ${result.skipped}`)
    if (result.failed > 0) parts.push(`失败 ${result.failed}`)
    statusText.textContent = `清理完成：${parts.join('；')}`

    await startScan()
  } catch (err) {
    statusText.textContent = `清理失败：${err instanceof Error ? err.message : String(err)}`
    updateSelectedSummary()
  }
}

scanBtn.addEventListener('click', () => {
  void handleScanButtonClick()
})
cleanBtn.addEventListener('click', cleanSelected)

async function loadDriveOptions(): Promise<void> {
  const fallback = ['C:', 'D:', 'E:']
  try {
    const drives = await window.diskClean.listDrives()
    const letters = drives.length > 0 ? drives : fallback
    driveSelect.innerHTML = '<option value="all">全部磁盘</option>'
    for (const drive of letters) {
      const option = document.createElement('option')
      option.value = drive
      option.textContent = `${drive} 盘`
      driveSelect.appendChild(option)
    }
  } catch {
    driveSelect.innerHTML = `
      <option value="all">全部磁盘</option>
      <option value="C:">C: 盘</option>
    `
  }
}

void loadDriveOptions()

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
      title.textContent = RULE_CATEGORY_LABELS[group.category]
      rulesList.appendChild(title)
    }

    for (const rule of group.rules) {
      const row = document.createElement('div')
      row.className = `rule-item${rule.enabled ? '' : ' disabled'}`

      const main = document.createElement('div')
      main.className = 'rule-item-main'
      const nameEl = document.createElement('div')
      nameEl.className = 'rule-item-name'
      nameEl.textContent = rule.name
      const metaEl = document.createElement('div')
      metaEl.className = 'rule-item-meta'
      metaEl.textContent = `${rule.contentType ? CONTENT_TYPE_LABELS[rule.contentType] + ' · ' : ''}${rule.id}${rule.source === 'custom' ? ' · 自定义' : ''}`
      main.append(nameEl, metaEl)

      const actions = document.createElement('div')
      actions.className = 'rule-item-actions'
      const toggleLabel = document.createElement('label')
      toggleLabel.className = 'rule-toggle'
      const toggle = document.createElement('input')
      toggle.type = 'checkbox'
      toggle.checked = rule.enabled
      toggleLabel.append(toggle, document.createElement('span'))

      actions.appendChild(toggleLabel)
      if (rule.source === 'custom') {
        const deleteBtn = document.createElement('button')
        deleteBtn.className = 'rule-delete'
        deleteBtn.textContent = '删除'
        actions.appendChild(deleteBtn)
      }

      row.append(main, actions)
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

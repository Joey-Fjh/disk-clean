/// <reference path="../preload/index.d.ts" />
import './settings-page'
import './provider-settings'
import type { Category, ScanError, ScanItem, ScanResult } from '../shared/types'
import {
  CANDIDATE_TAB_LABELS,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_ORDER,
  CONTENT_TYPE_LABELS,
  RULE_CATEGORY_LABELS,
  SCAN_PHASE_LABELS
} from '../shared/types'
import { formatBytes } from '../shared/format-bytes'
import { showConfirmDialog } from './confirm-dialog'
import { upsertScanItems } from '../shared/scan-item-accumulator'
import { normalizeCandidate } from '../shared/candidate-model'
import { RuleGroupExpansionState } from './rule-group-state'
import { ResultCategoryViewState } from './result-category-state'
import { CandidateSelectionViewState } from './candidate-selection-state'
import { buildScanItemRenderInput } from './candidate-render'
import { createScanItemElement } from './safe-render'

import {
  formatThemeSummary,
  type ThemeMode
} from './settings-summaries'
import { preservePanelScrollTop, switchMainTabPanel } from './panel-scroll'
import {
  onScanCancelledNoAnalysis,
  resetAgentAnalysisUi,
  runAgentAnalysisForSession,
  shouldAutoAnalyzeAfterScan,
  wireAgentAnalysisUi
} from './agent-analysis'
import {
  resetRuleDraftActionUi,
  updateRuleDraftActionState,
  wireRuleDraftActions
} from './rule-draft-actions'
import { RuleDraftCandidateSelectionState } from './rule-draft-candidate-selection'
import {
  advanceToActionStep,
  enterRuleExtensionMode,
  exitRuleExtensionMode,
  getRuleExtensionStep,
  isRuleExtensionModeActive,
  setExtensionEntryHostsVisible,
  shouldShowExtensionEntry,
  updateRuleSampleCount,
  wireRuleExtensionMode
} from './rule-extension-mode'
import {
  mapScanProgressPhaseToTaskPhase,
  resolveScanTaskHeadline,
  resolveScanTaskSubline,
  type ScanTaskPhase
} from './scan-task-state'
import { wireRuleKnowledgeSettings } from './rule-knowledge-settings'

const tabs = document.querySelectorAll<HTMLButtonElement>('.tab')
const panels = document.querySelectorAll<HTMLElement>('.tab-panel')
const panelClean = document.getElementById('panel-clean') as HTMLElement

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab!
    tabs.forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === target)
      t.setAttribute('aria-selected', String(t.dataset.tab === target))
    })
    switchMainTabPanel(panels, `panel-${target}`)
  })
})

wireRuleDraftActions(panelClean, () => ({
  scanResult,
  scanning,
  ruleDraftSelectedIds: ruleDraftSelection.getSelectedIds(),
  extensionStep: getRuleExtensionStep()
}))
wireRuleKnowledgeSettings()

wireAgentAnalysisUi({
  onItemsUpdated: (items) => {
    if (!scanResult) return
    scanResult = { ...scanResult, items }
    preservePanelScrollTop(panelClean, () => renderCategories(items))
    updateSelectedSummary()
  },
  onFailed: () => {
    scanTaskPhase = 'agent-failed'
    updateScanTaskStatus(scanResult?.items.length ?? 0)
  },
  openSettings: () => {
    const settingsTab = document.querySelector<HTMLButtonElement>('.tab[data-tab="settings"]')
    settingsTab?.click()
  }
})

// ── Theme ──
const themeControl = document.getElementById('theme-control')!
const themeButtons = themeControl.querySelectorAll<HTMLButtonElement>('.segment')
const themeCardSummary = document.getElementById('theme-card-summary') as HTMLSpanElement

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
  themeCardSummary.textContent = formatThemeSummary(mode)
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
const scanTaskStatusEl = document.getElementById('scan-task-status') as HTMLElement
const categoriesEl = document.getElementById('categories') as HTMLElement
const totalSizeEl = document.getElementById('total-size') as HTMLElement
const itemCountEl = document.getElementById('item-count') as HTMLElement
const selectedSizeEl = document.getElementById('selected-size') as HTMLElement
const totalSizeLabelEl = document.getElementById('total-size-label') as HTMLElement
const statusText = document.getElementById('status-text') as HTMLElement

let scanResult: ScanResult | null = null
let scanning = false
let scanTaskPhase: ScanTaskPhase = 'idle'
let renderTimer: number | null = null
const ruleGroupExpansion = new RuleGroupExpansionState()
const resultCategoryView = new ResultCategoryViewState()
const candidateSelection = new CandidateSelectionViewState()
const ruleDraftSelection = new RuleDraftCandidateSelectionState()

function formatSize(bytes: number): string {
  return formatBytes(bytes)
}

function categoryBadgeClass(category: Category): string {
  if (category === 'safe') return 'badge-safe'
  if (category === 'recommended') return 'badge-recommended'
  return 'badge-dangerous'
}

function updateScanTaskStatus(discoveredCount = 0): void {
  if (!scanTaskStatusEl) return
  scanTaskStatusEl.textContent = resolveScanTaskSubline({
    phase: scanTaskPhase,
    discoveredCount,
    agentStatus: undefined
  })
}

function syncRuleExtensionUi(): void {
  const count = ruleDraftSelection.getSelectedIds().size
  updateRuleSampleCount(count)
  updateRuleDraftActionState({
    scanResult,
    scanning,
    ruleDraftSelectedIds: ruleDraftSelection.getSelectedIds(),
    extensionStep: getRuleExtensionStep()
  })
}

function createExtensionEntryHost(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'rule-extension-entry-host'
  wrap.dataset.role = 'rule-extension-entry-host'

  const desc = document.createElement('p')
  desc.className = 'rule-extension-entry-desc'
  desc.textContent =
    '这些项目尚未获得清理授权。如果你确认它们属于可重复生成的缓存，可以创建识别规则。'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'btn btn-secondary'
  btn.id = 'rule-extension-entry'
  btn.textContent = '创建识别规则'
  btn.addEventListener('click', () => {
    enterRuleExtensionMode()
    setExtensionEntryHostsVisible(false)
    syncRuleExtensionUi()
    if (scanResult) {
      preservePanelScrollTop(panelClean, () => renderCategories(scanResult!.items))
    }
  })

  wrap.append(desc, btn)
  return wrap
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
  scanTaskPhase = mapScanProgressPhaseToTaskPhase(true, p.phase)
  progressLabel.textContent = resolveScanTaskHeadline({
    phase: scanTaskPhase,
    discoveredCount: p.current,
    agentStatus: undefined
  })
  updateScanTaskStatus(p.current)

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
    preservePanelScrollTop(panelClean, () => {
      if (scanning) renderScanningDiscoveries(items)
      else renderCategories(items)
    })
    renderTimer = null
  }, 120)
}

function renderScanningDiscoveries(items: ScanItem[]): void {
  categoriesEl.innerHTML = ''
  const wrapper = document.createElement('section')
  wrapper.className = 'scanning-discoveries'

  const title = document.createElement('h3')
  title.className = 'scanning-discoveries-title'
  title.textContent = `正在识别（${items.length}）`
  wrapper.appendChild(title)

  const hint = document.createElement('p')
  hint.className = 'scanning-discoveries-hint'
  hint.textContent = '扫描与本地规则整理完成前，结果仅供预览，不可勾选清理。'
  wrapper.appendChild(hint)

  const list = document.createElement('ul')
  list.className = 'item-list'
  for (const item of items.slice(-50)) {
    list.appendChild(renderScanItemElement(item))
  }
  wrapper.appendChild(list)
  categoriesEl.appendChild(wrapper)
  updateScanTaskStatus(items.length)
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
  scanTaskPhase = cancelled ? 'cancelled' : 'organizing-local'
  updateScanTaskStatus(items.length)

  exitRuleExtensionMode()

  candidateSelection.reconcileFinalItems(items, getDefaultChecked)

  progress.hidden = true
  updateLiveSummary(items)
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer)
    renderTimer = null
  }
  preservePanelScrollTop(panelClean, () => renderCategories(items))
  updateSelectedSummary()

  const driveLabel = drive === 'all' ? '全部磁盘' : `${drive} 盘`
  if (cancelled) {
    statusText.textContent = `${driveLabel} · 扫描已停止 · 保留 ${items.length} 项结果`
    scanTaskPhase = 'cancelled'
  } else if (errors.length > 0) {
    statusText.textContent = `${driveLabel} · 扫描完成，${errors.length} 个路径因权限等原因跳过`
    scanTaskPhase = 'completed'
  } else {
    statusText.textContent = `${driveLabel} · 扫描完成 · ${new Date(result.scannedAt).toLocaleString('zh-CN')}`
    scanTaskPhase = 'completed'
  }
  updateScanTaskStatus(items.length)

  if (shouldAutoAnalyzeAfterScan(cancelled === true)) {
    scanTaskPhase = 'agent-reviewing'
    updateScanTaskStatus(items.length)
    void runAgentAnalysisForSession(result.sessionId, {
      onItemsUpdated: (items) => {
        if (!scanResult || scanResult.sessionId !== result.sessionId) return
        scanResult = { ...scanResult, items }
        candidateSelection.reconcileAfterAgentUpdate(items, isSelectable, getDefaultChecked)
        preservePanelScrollTop(panelClean, () => renderCategories(items))
        updateSelectedSummary()
        scanTaskPhase = 'completed'
        updateScanTaskStatus(items.length)
      },
      onFailed: () => {
        scanTaskPhase = 'agent-failed'
        updateScanTaskStatus(items.length)
      },
      openSettings: () => {
        document.querySelector<HTMLButtonElement>('.tab[data-tab="settings"]')?.click()
      }
    })
  } else {
    onScanCancelledNoAnalysis(result.sessionId)
    scanTaskPhase = cancelled ? 'cancelled' : 'completed'
    updateScanTaskStatus(items.length)
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
    updateRuleDraftActionState({
      scanResult: null,
      scanning,
      ruleDraftSelectedIds: ruleDraftSelection.getSelectedIds(),
      extensionStep: getRuleExtensionStep()
    })
    return
  }
  const selected = scanResult.items.filter((i) => candidateSelection.isSelected(i.id) && isSelectable(i))
  const size = selected.reduce((s, i) => s + i.size, 0)
  selectedSizeEl.textContent = formatSize(size)
  cleanBtn.disabled = scanning || selected.length === 0
  updateRuleDraftActionState({
    scanResult,
    scanning,
    ruleDraftSelectedIds: ruleDraftSelection.getSelectedIds(),
    extensionStep: getRuleExtensionStep()
  })
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

  const activeCategory = resultCategoryView.resolveActiveCategory(items)

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
    const selectedCount = deletable.filter((item) => candidateSelection.isSelected(item.id)).length
    selectAllCb.checked = selectedCount > 0 && selectedCount === deletable.length
    selectAllCb.indeterminate = selectedCount > 0 && selectedCount < deletable.length
  }

  function setListSelection(
    list: HTMLElement,
    catItems: ScanItem[],
    selected: boolean,
    selectAllCb: HTMLInputElement
  ): void {
    const ids = getDeletableItems(catItems).map((item) => item.id)
    candidateSelection.setMany(ids, selected)
    list.querySelectorAll<HTMLInputElement>('input[data-role="cleanup"]:not(:disabled)').forEach((cb) => {
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

        const checkbox = li.querySelector('input[data-role="cleanup"]') as HTMLInputElement
        checkbox.dataset.id = item.id
        checkbox.checked =
          normalized.selection.selectable && candidateSelection.isSelected(item.id)
        checkbox.disabled = !normalized.selection.selectable
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) candidateSelection.select(item.id)
          else candidateSelection.deselect(item.id)
          updateSelectAllState(selectAllCb, catItems)
          updateSelectedSummary()
        })

        const draftPickLabel = document.createElement('label')
        draftPickLabel.className = 'rule-draft-pick'
        draftPickLabel.hidden = !isRuleExtensionModeActive()
        draftPickLabel.title = '选作规则样本（与清理勾选独立）'
        const draftPick = document.createElement('input')
        draftPick.type = 'checkbox'
        draftPick.dataset.role = 'rule-draft'
        draftPick.dataset.id = item.id
        draftPick.checked = ruleDraftSelection.isSelected(item.id)
        draftPick.disabled = scanning || !scanResult?.sessionId
        draftPick.addEventListener('change', () => {
          ruleDraftSelection.toggle(item.id, draftPick.checked)
          syncRuleExtensionUi()
        })
        draftPickLabel.append(draftPick, document.createTextNode('规则样本'))
        li.appendChild(draftPickLabel)

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
    tab.className = `category-tab${category === activeCategory ? ' active' : ''}`
    tab.dataset.category = category
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(category === activeCategory))
    tab.innerHTML = `
      <span class="category-tab-label">${CANDIDATE_TAB_LABELS[category]}</span>
      <span class="category-tab-meta">${catItems.length} 项 · ${formatSize(catSize)}</span>
    `
    tab.addEventListener('click', () => {
      resultCategoryView.select(category)
      switchCategory(category)
    })
    tabBar.appendChild(tab)

    const panel = document.createElement('section')
    panel.className = `category-panel${category === activeCategory ? ' active' : ''}`
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

    if (
      category === 'dangerous' &&
      shouldShowExtensionEntry({
        scanning,
        hasSession: Boolean(scanResult?.sessionId),
        cancelled: scanResult?.cancelled,
        dangerousCandidateCount: catItems.length
      })
    ) {
      panel.querySelector('.category-panel-header')?.appendChild(createExtensionEntryHost())
    }

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
        updateSelectAllState(selectAllCb, catItems)

        selectAllCb.addEventListener('change', () => {
          setListSelection(list, catItems, selectAllCb.checked, selectAllCb)
        })

        header.appendChild(selectAllLabel)
        panel.appendChild(list)
      } else {
        const list = renderItemList(category, catItems, document.createElement('input'))
        panel.appendChild(list)
      }
    }

    panels.appendChild(panel)
  }

  wrapper.appendChild(tabBar)
  wrapper.appendChild(panels)
  categoriesEl.appendChild(wrapper)
}

async function startScan(options: { drive?: string; confirmRescan?: boolean } = {}): Promise<void> {
  const drive = options.drive ?? (driveSelect.value || 'all')
  if (
    options.confirmRescan !== false &&
    scanResult &&
    scanResult.items.some((item) => candidateSelection.isSelected(item.id) && isSelectable(item))
  ) {
    const confirmed = await showConfirmDialog({
      title: '重新扫描',
      message: '重新扫描会替换当前结果并清除已勾选项目。',
      details: ['当前清理勾选将丢失', '规则样本选择模式将退出']
    })
    if (!confirmed) return
  }

  setScanning(true)
  scanTaskPhase = 'scanning-disk'
  updateScanTaskStatus(0)
  candidateSelection.clear()
  ruleDraftSelection.clear()
  resetAgentAnalysisUi()
  resetRuleDraftActionUi()
  exitRuleExtensionMode()
  ruleGroupExpansion.clear()
  resultCategoryView.clear()
  scanResult = null
  progress.hidden = false
  summary.hidden = false
  categoriesEl.innerHTML = ''
  progressFill.style.width = '0%'
  progressRule.textContent = '准备开始…'
  progressLabel.textContent = resolveScanTaskHeadline({
    phase: 'scanning-disk',
    discoveredCount: 0
  })
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

  const selected = scanResult.items.filter((i) => candidateSelection.isSelected(i.id) && isSelectable(i))
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

wireRuleExtensionMode({
  onExit: () => {
    const result = scanResult
    if (!result) return
    setExtensionEntryHostsVisible(true)
    syncRuleExtensionUi()
    preservePanelScrollTop(panelClean, () => renderCategories(result.items))
  },
  onNext: async () => {
    if (!scanResult || ruleDraftSelection.getSelectedIds().size === 0) return
    const hasProvider = await window.diskClean.getProviderConfig()
    advanceToActionStep(Boolean(hasProvider?.hasKey))
    syncRuleExtensionUi()
  },
  onBackToSelect: () => {
    syncRuleExtensionUi()
  },
  onOpenSettings: () => {
    document.querySelector<HTMLButtonElement>('.tab[data-tab="settings"]')?.click()
    document.getElementById('settings-card-rules-header')?.click()
    document.querySelector<HTMLButtonElement>('[data-rules-knowledge-tab="drafts"]')?.click()
  },
  onBackToResults: () => {
    const result = scanResult
    if (!result) return
    setExtensionEntryHostsVisible(true)
    syncRuleExtensionUi()
    preservePanelScrollTop(panelClean, () => renderCategories(result.items))
  },
  getSelectedCount: () => ruleDraftSelection.getSelectedIds().size
})

window.addEventListener('diskclean:trigger-rescan', () => {
  void triggerRescanFromSettings()
})

async function triggerRescanFromSettings(drive?: string): Promise<void> {
  document.querySelector<HTMLButtonElement>('.tab[data-tab="clean"]')?.click()
  if (drive) driveSelect.value = drive
  await startScan({ drive: drive ?? driveSelect.value, confirmRescan: true })
}

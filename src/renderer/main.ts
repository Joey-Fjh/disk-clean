/// <reference path="../preload/index.d.ts" />
import './settings-page'
import './provider-settings'
import type { Category, ScanError, ScanItem, ScanResult } from '../shared/types'
import {
  CLEANUP_DISPLAY_CATEGORY_DESCRIPTIONS,
  CLEANUP_DISPLAY_CATEGORY_LABELS,
  type CleanupDisplayCategory,
  groupItemsByDisplayCategory
} from '../shared/cleanup-display-category'
import {
  CATEGORY_DESCRIPTIONS,
  CONTENT_TYPE_LABELS,
  RULE_CATEGORY_LABELS,
  SCAN_PHASE_LABELS
} from '../shared/types'
import { formatBytes } from '../shared/format-bytes'
import { activeProfileHasKey } from '../shared/provider-profile-utils'
import { showConfirmDialog } from './confirm-dialog'
import { upsertScanItems } from '../shared/scan-item-accumulator'
import { normalizeCandidate } from '../shared/candidate-model'
import { RuleGroupExpansionState } from './rule-group-state'
import { ResultCategoryViewState, CLEANUP_DISPLAY_CATEGORY_ORDER } from './result-category-state'
import { CandidateSelectionViewState } from './candidate-selection-state'
import { buildScanItemRenderInput } from './candidate-render'
import { createScanItemElement } from './safe-render'

import {
  formatThemeSummary,
  type ThemeMode
} from './settings-summaries'
import { preservePanelScrollTop, switchMainTabPanel } from './panel-scroll'
import {
  buildCleanupOutcomeManifest,
  buildCleanupRescanComparison,
  formatCleanupOutcomeSummary,
  formatCleanupRescanComparison,
} from './cleanup-result-state'
import {
  applyPostCleanupRescanFailure,
  applyPostCleanupRescanFinish,
  beginPostCleanupRescanSession,
  buildPostCleanupRescanScanOptions,
  canRetryPostCleanupRescan,
  commitScanPreflight,
  createPostCleanupRescanSession,
  isPostCleanupRescanActive,
  markPostCleanupRescanIdle,
  planScanPreflight,
  reducePostCleanupRescanSession,
  resolvePersistentCleanupStatusText,
  resolveScanInitializationStatusText,
  shouldSkipAutoAgentForScan
} from './post-cleanup-rescan-controller'
import { buildAgentInvestigationCandidates } from '../shared/agent-candidate-prep'
import { buildCandidateRefIndex } from '../shared/candidate-ref-index'
import {
  getCurrentAgentAnalysis,
  onScanCancelledNoAnalysis,
  resetAgentAnalysisUi,
  runAgentAnalysisForSession,
  shouldAutoAnalyzeAfterScan,
  wireAgentAnalysisUi
} from './agent-analysis'
import { createAgentAnalysisSessionCallbacks } from './agent-session-lifecycle'
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
  resolveScanProgressTaskPhase,
  type ScanTaskPhase
} from './scan-task-state'
import { resolveTaskHeadline, resolveTaskSubline, runPlanningPhase } from './cleanup-task-ui'
import { appendDomInBatches } from './batch-dom'
import { buildResultStructureKey, patchResultCategoriesDom } from './result-category-patch'
import { wireRuleKnowledgeSettings } from './rule-knowledge-settings'
import {
  resolveProgressBarMode,
  shouldShowExtensionEntryForCategory,
  shouldShowFinalResultCategories
} from '../shared/ux-flow-model'
import {
  applyProgressBarMode,
  renderCleanupOutcomePanel,
  renderTaskPipeline
} from './ux-flow-render'
import { TaskPipelineState, applyResultsReadyPipeline } from './task-pipeline-state'
import { resolveInteractiveTaskRecovery, resolveScanFailureRecovery } from './task-ui-recovery'

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

wireRuleDraftActions(
  panelClean,
  () => ({
    scanResult,
    scanning,
    ruleDraftSelectedIds: ruleDraftSelection.getSelectedIds(),
    extensionStep: getRuleExtensionStep()
  }),
  () => {
    scanBtn.click()
  }
)
wireRuleKnowledgeSettings()

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
const retryRescanBtn = document.getElementById('retry-rescan-btn') as HTMLButtonElement
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
const taskPipelineEl = document.getElementById('task-pipeline') as HTMLElement
const cleanupOutcomePanel = document.getElementById('cleanup-outcome-panel') as HTMLElement

let scanResult: ScanResult | null = null
let scanning = false
let scanTaskPhase: ScanTaskPhase = 'idle'
let agentCandidateCount = 0
let renderTimer: number | null = null
let lastResultStructureKey: string | null = null
let lastDiscoveryRenderCount = 0
let lastScanProgress: {
  phase?: 'space-discovery' | 'rule-identification'
  current: number
  total: number
} | null = null
let activeBatchCancels = new Set<() => void>()
let postCleanupRescanSession = createPostCleanupRescanSession()
let skipAutoAgentForCurrentScan = false
let cachedPathAccessPolicy: import('../shared/path-access-policy').PathAccessPolicy | null = null
const taskPipelineState = new TaskPipelineState()

function syncPersistentCleanupStatus(): void {
  const text = resolvePersistentCleanupStatusText(postCleanupRescanSession)
  if (text) statusText.textContent = text
}

function refreshRescanRetryButton(): void {
  retryRescanBtn.hidden = !canRetryPostCleanupRescan(postCleanupRescanSession)
}

function cancelActiveBatchRender(): void {
  for (const cancel of activeBatchCancels) cancel()
  activeBatchCancels.clear()
}

function registerBatchRender(cancel: () => void): void {
  activeBatchCancels.add(cancel)
}

async function getRendererPathAccessPolicy(): Promise<import('../shared/path-access-policy').PathAccessPolicy> {
  if (!cachedPathAccessPolicy) {
    const safety = await window.diskClean.getSafetyPolicy()
    cachedPathAccessPolicy = safety.pathAccessPolicy
  }
  return cachedPathAccessPolicy
}
const ruleGroupExpansion = new RuleGroupExpansionState()
const resultCategoryView = new ResultCategoryViewState()
const candidateSelection = new CandidateSelectionViewState()
const ruleDraftSelection = new RuleDraftCandidateSelectionState()

function formatSize(bytes: number): string {
  return formatBytes(bytes)
}

function getDriveLabel(): string {
  const drive = driveSelect.value
  return drive === 'all' ? '全部磁盘' : `${drive} 盘`
}

function displayCategoryBadgeClass(category: CleanupDisplayCategory): string {
  if (category === 'recommended-clean') return 'badge-safe'
  if (category === 'caution-clean' || category === 'space-occupancy') return 'badge-recommended'
  return 'badge-dangerous'
}

function isAgentReviewing(): boolean {
  return scanTaskPhase === 'analyzing'
}

function getTaskProgressContext(discoveredCount: number) {
  return {
    phase: scanTaskPhase,
    driveLabel: getDriveLabel(),
    discoveredCount,
    agentStatus: getCurrentAgentAnalysis()?.status,
    agentCandidateCount,
    resultsUpdating: scanning || scanTaskPhase === 'analyzing' || scanTaskPhase === 'planning'
  }
}

function refreshTaskProgressUi(discoveredCount = scanResult?.items.length ?? 0): void {
  const ctx = getTaskProgressContext(discoveredCount)
  if (progressLabel) progressLabel.textContent = resolveTaskHeadline(ctx)
  if (scanTaskStatusEl) scanTaskStatusEl.textContent = resolveTaskSubline(ctx)
  renderTaskPipeline(taskPipelineEl, {
    phase: scanTaskPhase,
    scanning,
    hasScanResults: Boolean(scanResult && scanResult.items.length > 0),
    milestone: taskPipelineState.getMilestone(),
    analyzeSkipped: taskPipelineState.isAnalyzeSkipped()
  })
  const barMode = resolveProgressBarMode({
    scanning,
    phase: scanTaskPhase,
    scanPhase: scanning ? lastScanProgress?.phase : undefined
  })
  const percent =
    barMode === 'determinate' && lastScanProgress && lastScanProgress.total > 0
      ? Math.min((lastScanProgress.current / lastScanProgress.total) * 100, 95)
      : 0
  applyProgressBarMode(progress, progressFill, barMode, percent)
}

function restoreInteractiveTaskState(itemCount: number, phase: ScanTaskPhase = 'completed'): void {
  const recovery = resolveInteractiveTaskRecovery(itemCount, phase)
  scanTaskPhase = recovery.phase
  progress.hidden = recovery.progressHidden
  refreshTaskProgressUi(itemCount)
}

function showFinalResults(items: ScanItem[], phase: ScanTaskPhase = 'completed'): void {
  scanTaskPhase = phase
  taskPipelineState.advance('suggest')
  refreshTaskProgressUi(items.length)
  preservePanelScrollTop(panelClean, () => renderCategories(items))
  updateSelectedSummary()
}

function updateScanTaskStatus(discoveredCount = 0): void {
  refreshTaskProgressUi(discoveredCount)
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
  btn.textContent = '扩展清理识别'
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
  scanTaskPhase = resolveScanProgressTaskPhase({
    currentPhase: scanTaskPhase,
    isPostCleanupRescan: isPostCleanupRescanActive(postCleanupRescanSession),
    scanPhase: p.phase,
    agentReviewing: isAgentReviewing()
  })
  lastScanProgress = {
    phase: p.phase,
    current: p.current,
    total: p.total
  }
  refreshTaskProgressUi(p.current)

  if (p.phase === 'space-discovery') {
    progressRule.textContent = p.label || '…'
    progressHint.textContent = `空间发现 · 已发现 ${p.current} 项`
  } else {
    progressRule.textContent = p.label || p.ruleName || '…'
    progressHint.textContent = `${RULE_CATEGORY_LABELS[p.category]} · 本档 ${p.categoryCurrent}/${p.categoryTotal}`
  }
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
  const existing = categoriesEl.querySelector('.scanning-discoveries')
  if (existing && items.length >= lastDiscoveryRenderCount) {
    const title = existing.querySelector('.scanning-discoveries-title')
    if (title) title.textContent = `正在识别（${items.length}）`
    const list = existing.querySelector('ul.item-list')
    if (list) {
      const slice = items.slice(lastDiscoveryRenderCount, items.length)
      for (const item of slice.slice(-50)) {
        list.appendChild(renderScanItemElement(item))
      }
      while (list.childElementCount > 50) {
        list.firstElementChild?.remove()
      }
    }
    lastDiscoveryRenderCount = items.length
    updateScanTaskStatus(items.length)
    return
  }

  lastDiscoveryRenderCount = items.length
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
  scanBtn.textContent = active ? '停止扫描' : '开始清理扫描'
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
  scanTaskPhase = cancelled ? 'cancelled' : 'organizing'
  taskPipelineState.advance('scan')
  updateScanTaskStatus(items.length)

  exitRuleExtensionMode()

  candidateSelection.reconcileFinalItems(items, getDefaultChecked)

  progress.hidden = true
  updateLiveSummary(items)
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer)
    renderTimer = null
  }
  updateSelectedSummary()

  const driveLabel = drive === 'all' ? '全部磁盘' : `${drive} 盘`
  if (isPostCleanupRescanActive(postCleanupRescanSession)) {
    if (cancelled) {
      postCleanupRescanSession = applyPostCleanupRescanFinish(postCleanupRescanSession, { cancelled: true })
      skipAutoAgentForCurrentScan = false
      syncPersistentCleanupStatus()
      refreshRescanRetryButton()
      taskPipelineState.advance('review')
      showFinalResults(items, 'completed')
      return
    }
    if (postCleanupRescanSession.pendingCleanupOutcome && postCleanupRescanSession.cleanupOutcomeSummary) {
      const manifest = postCleanupRescanSession.pendingCleanupOutcome
      const comparison = buildCleanupRescanComparison(manifest, items)
      const comparisonDetail = formatCleanupRescanComparison(comparison)
      postCleanupRescanSession = applyPostCleanupRescanFinish(postCleanupRescanSession, {
        cancelled: false,
        comparisonDetail
      })
      renderCleanupOutcomePanel(cleanupOutcomePanel, manifest, comparisonDetail)
    } else {
      postCleanupRescanSession = markPostCleanupRescanIdle(postCleanupRescanSession)
    }
    skipAutoAgentForCurrentScan = false
    syncPersistentCleanupStatus()
    refreshRescanRetryButton()
    taskPipelineState.advance('review')
    showFinalResults(items, 'completed')
    return
  }

  if (cancelled) {
    statusText.textContent = `${driveLabel} · 扫描已停止 · 保留 ${items.length} 项结果`
    showFinalResults(items, 'cancelled')
    return
  }

  if (errors.length > 0) {
    statusText.textContent = `${driveLabel} · 扫描完成，${errors.length} 个路径因权限等原因跳过`
  } else {
    statusText.textContent = `${driveLabel} · 扫描完成 · ${new Date(result.scannedAt).toLocaleString('zh-CN')}`
  }

  if (shouldAutoAnalyzeAfterScan(false) && !skipAutoAgentForCurrentScan) {
    void (async () => {
      const pathPolicy = await getRendererPathAccessPolicy()
      const refIndex = buildCandidateRefIndex(items, 'ui-preview', 0)
      agentCandidateCount = buildAgentInvestigationCandidates(items, {
        pathAccessPolicy: pathPolicy,
        refIndex
      }).length
      scanTaskPhase = 'analyzing'
      refreshTaskProgressUi(items.length)
      await runAgentAnalysisForSession(
        result.sessionId,
        createAppAgentAnalysisCallbacks(result.sessionId)
      )
    })()
  } else {
    onScanCancelledNoAnalysis(result.sessionId)
    taskPipelineState.markAnalyzeSkipped()
    void (async () => {
      if (!cancelled) {
        await runPlanningPhase(
          (phase) => {
            scanTaskPhase = phase
          },
          () => refreshTaskProgressUi(items.length)
        )
      }
      showFinalResults(items, cancelled ? 'cancelled' : 'completed')
    })()
  }
}

function getDefaultChecked(item: ScanItem): boolean {
  const normalized = normalizeCandidate(item)
  return normalized.selection.selectable && normalized.autoSelect
}

function openAgentSettingsTab(): void {
  document.querySelector<HTMLButtonElement>('.tab[data-tab="settings"]')?.click()
}

function createAppAgentAnalysisCallbacks(sessionId?: string) {
  return createAgentAnalysisSessionCallbacks({
    sessionId,
    getScanResult: () => scanResult,
    setScanResult: (result) => {
      scanResult = result
    },
    setTaskPhase: (phase) => {
      scanTaskPhase = phase
    },
    refreshTaskProgress: refreshTaskProgressUi,
    reconcileSelection: async (items) => {
      candidateSelection.reconcileAfterAgentUpdate(items, isSelectable, getDefaultChecked)
    },
    renderCategories: (items) => renderCategories(items),
    updateSelectedSummary,
    preservePanelScroll: (fn) => preservePanelScrollTop(panelClean, fn),
    openSettings: openAgentSettingsTab,
    onResultsReady: (items, analysisStatus) => {
      applyResultsReadyPipeline(taskPipelineState, analysisStatus)
      refreshTaskProgressUi(items.length)
    }
  })
}

wireAgentAnalysisUi(createAppAgentAnalysisCallbacks())

function renderScanItemElement(item: ScanItem): HTMLLIElement {
  const li = createScanItemElement(
    buildScanItemRenderInput(item, {
      contentTypeLabel: CONTENT_TYPE_LABELS[item.contentType]
    })
  )
  li.dataset.itemId = item.id
  return li
}

function wireScanItemListElement(
  li: HTMLLIElement,
  item: ScanItem,
  catItems: ScanItem[],
  selectAllCb: HTMLInputElement
): void {
  const normalized = normalizeCandidate(item)
  const checkbox = li.querySelector('input[data-role="cleanup"]') as HTMLInputElement
  checkbox.dataset.id = item.id
  checkbox.checked = normalized.selection.selectable && candidateSelection.isSelected(item.id)
  checkbox.disabled = !normalized.selection.selectable
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) candidateSelection.select(item.id)
    else candidateSelection.deselect(item.id)
    const deletable = catItems.filter((entry) => isSelectable(entry))
    const selectedCount = deletable.filter((entry) => candidateSelection.isSelected(entry.id)).length
    selectAllCb.checked = selectedCount > 0 && selectedCount === deletable.length
    selectAllCb.indeterminate = selectedCount > 0 && selectedCount < deletable.length
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
  draftPickLabel.append(draftPick, document.createTextNode('识别样本'))
  li.appendChild(draftPickLabel)

  const pathBtnEl = li.querySelector('.item-path') as HTMLButtonElement
  pathBtnEl.addEventListener('click', async () => {
    try {
      await window.diskClean.openInExplorer(item.path)
    } catch (err) {
      statusText.textContent = `无法打开：${err instanceof Error ? err.message : String(err)}`
    }
  })
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
  if (!shouldShowFinalResultCategories({
    scanning,
    phase: scanTaskPhase,
    agentReviewing: isAgentReviewing()
  })) {
    if (scanning) renderScanningDiscoveries(items)
    return
  }

  const structureKey = buildResultStructureKey(items, { agentReviewing: isAgentReviewing() })
  const existingPanel = categoriesEl.querySelector('.result-panel') as HTMLElement | null
  if (existingPanel && lastResultStructureKey === structureKey) {
    const grouped = groupItemsByDisplayCategory(items, { agentReviewing: isAgentReviewing() })
    const patched = patchResultCategoriesDom(existingPanel, items, {
      agentReviewing: isAgentReviewing(),
      formatSize,
      createListItem: (item) => {
        const category = CLEANUP_DISPLAY_CATEGORY_ORDER.find((cat) =>
          (grouped[cat] ?? []).some((entry) => entry.id === item.id)
        )
        const catItems = category ? (grouped[category] ?? []) : []
        const panel = category
          ? existingPanel.querySelector<HTMLElement>(`#cat-panel-${category}`)
          : null
        const selectAllCb = panel?.querySelector<HTMLInputElement>('.select-all-checkbox')
        const li = renderScanItemElement(item)
        if (selectAllCb) wireScanItemListElement(li, item, catItems, selectAllCb)
        return li
      }
    })
    if (patched) {
      cancelActiveBatchRender()
      lastResultStructureKey = structureKey
      return
    }
  }

  lastResultStructureKey = structureKey
  cancelActiveBatchRender()
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

  const order = CLEANUP_DISPLAY_CATEGORY_ORDER.filter((cat) => {
    if (cat === 'identifying' || cat === 'analyzing') {
      return scanning || isAgentReviewing()
    }
    return true
  })
  const grouped = groupItemsByDisplayCategory(items, { agentReviewing: isAgentReviewing() })

  const activeCategory = resultCategoryView.resolveActiveCategory(items, {
    agentReviewing: isAgentReviewing()
  })

  const wrapper = document.createElement('div')
  wrapper.className = 'result-panel'
  wrapper.dataset.structureKey = structureKey

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
    category: CleanupDisplayCategory,
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
      group.dataset.ruleName = ruleName

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

      const renderListItem = (item: ScanItem): HTMLLIElement => {
        const li = renderScanItemElement(item)
        wireScanItemListElement(li, item, catItems, selectAllCb)
        return li
      }

      registerBatchRender(appendDomInBatches(list, ruleItems, renderListItem))

      body.appendChild(list)
      group.appendChild(body)
      container.appendChild(group)
    }

    return container
  }

  function switchCategory(category: CleanupDisplayCategory): void {
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
    const catItems = grouped[category] ?? []
    const catSize = catItems.reduce((s, i) => s + i.size, 0)
    if (catItems.length === 0 && category !== 'identifying' && category !== 'analyzing') {
      continue
    }
    const badgeClass = displayCategoryBadgeClass(category)

    const tab = document.createElement('button')
    tab.className = `category-tab${category === activeCategory ? ' active' : ''}`
    tab.dataset.category = category
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(category === activeCategory))
    tab.innerHTML = `
      <span class="category-tab-label">${CLEANUP_DISPLAY_CATEGORY_LABELS[category]}</span>
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
          <span class="category-badge ${badgeClass}">${CLEANUP_DISPLAY_CATEGORY_LABELS[category]}</span>
          <p class="category-desc">${CLEANUP_DISPLAY_CATEGORY_DESCRIPTIONS[category]}</p>
        </div>
      </div>
    `

    if (
      shouldShowExtensionEntryForCategory(category) &&
      shouldShowExtensionEntry({
        scanning,
        hasSession: Boolean(scanResult?.sessionId),
        cancelled: scanResult?.cancelled,
        extensionCandidateCount: catItems.length
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

async function startPostCleanupRescan(): Promise<void> {
  if (!canRetryPostCleanupRescan(postCleanupRescanSession)) return
  if (postCleanupRescanSession.inFlight) return
  const options = buildPostCleanupRescanScanOptions(postCleanupRescanSession)
  if (!options) return
  postCleanupRescanSession = reducePostCleanupRescanSession(postCleanupRescanSession, { type: 'retry-rescan' })
  scanTaskPhase = 'rescanning'
  progress.hidden = false
  refreshTaskProgressUi(scanResult?.items.length ?? 0)
  syncPersistentCleanupStatus()
  refreshRescanRetryButton()
  await startScan(options)
}

async function startScan(
  options: { drive?: string; confirmRescan?: boolean; skipAutoAgent?: boolean; ordinaryScan?: boolean } = {}
): Promise<void> {
  const drive = options.drive ?? (driveSelect.value || 'all')
  const isOrdinaryScan = options.ordinaryScan === true
  const hasSelectedItems = Boolean(
    scanResult?.items.some((item) => candidateSelection.isSelected(item.id) && isSelectable(item))
  )
  const preflight = planScanPreflight(postCleanupRescanSession, {
    isOrdinaryScan,
    hasSelectedItems,
    confirmRescan: options.confirmRescan
  })

  if (preflight.combinedConfirm) {
    const confirmed = await showConfirmDialog({
      title: '开始新扫描',
      message: '开始新的普通扫描将放弃当前清理复核上下文，并清除已勾选项目。',
      details: ['未完成的复核结果将不再保留', '如需复核请使用「重新复核」', '规则样本选择模式将退出']
    })
    if (!confirmed) return
  } else {
    if (preflight.needsAbandonRescanConfirm) {
      const confirmed = await showConfirmDialog({
        title: '开始新扫描',
        message: '开始新的普通扫描将放弃当前清理复核上下文。',
        details: ['未完成的复核结果将不再保留', '如需复核请使用「重新复核」']
      })
      if (!confirmed) return
    }
    if (preflight.needsClearSelectionConfirm) {
      const confirmed = await showConfirmDialog({
        title: '重新扫描',
        message: '重新扫描会替换当前结果并清除已勾选项目。',
        details: ['当前清理勾选将丢失', '规则样本选择模式将退出']
      })
      if (!confirmed) return
    }
  }

  const committed = commitScanPreflight(postCleanupRescanSession, {
    isOrdinaryScan,
    skipAutoAgentOption: options.skipAutoAgent
  })
  postCleanupRescanSession = committed.session
  skipAutoAgentForCurrentScan = committed.skipAutoAgent
  const isPostCleanupRescan = isPostCleanupRescanActive(postCleanupRescanSession)
  if (isOrdinaryScan) {
    refreshRescanRetryButton()
    renderCleanupOutcomePanel(cleanupOutcomePanel, null)
    taskPipelineState.reset()
  }

  setScanning(true)
  scanTaskPhase = isPostCleanupRescan ? 'rescanning' : 'scanning'
  updateScanTaskStatus(0)
  candidateSelection.clear()
  ruleDraftSelection.clear()
  resetAgentAnalysisUi()
  resetRuleDraftActionUi()
  exitRuleExtensionMode()
  ruleGroupExpansion.clear()
  resultCategoryView.clear()
  lastResultStructureKey = null
  lastDiscoveryRenderCount = 0
  lastScanProgress = null
  cachedPathAccessPolicy = null
  cancelActiveBatchRender()
  scanResult = null
  progress.hidden = false
  summary.hidden = false
  categoriesEl.innerHTML = ''
  progressFill.style.width = '0%'
  progressRule.textContent = '准备开始…'
  progressLabel.textContent = resolveTaskHeadline({
    phase: scanTaskPhase,
    driveLabel: getDriveLabel(),
    discoveredCount: 0,
    agentStatus: undefined
  })
  progressHint.textContent = isPostCleanupRescan
    ? '正在自动复核清理结果…'
    : `${drive === 'all' ? '全部磁盘' : `${drive} 盘`} · 统一扫描`
  statusText.textContent = resolveScanInitializationStatusText(
    postCleanupRescanSession,
    '扫描中，发现的项目将实时列出…'
  )

  let accumulatedItems: ScanItem[] = []
  let accumulatedErrors: ScanError[] = []
  let scanFailureItemCount: number | null = null
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
    const isRescanFailure = isPostCleanupRescanActive(postCleanupRescanSession)
    if (isRescanFailure && postCleanupRescanSession.cleanupOutcomeSummary) {
      postCleanupRescanSession = applyPostCleanupRescanFailure(
        postCleanupRescanSession,
        err instanceof Error ? err.message : String(err)
      )
      syncPersistentCleanupStatus()
      refreshRescanRetryButton()
    } else {
      statusText.textContent = `扫描失败：${err instanceof Error ? err.message : String(err)}`
    }
    const failureRecovery = resolveScanFailureRecovery(isRescanFailure)
    scanTaskPhase = failureRecovery.phase
    scanFailureItemCount = accumulatedItems.length
  } finally {
    postCleanupRescanSession = markPostCleanupRescanIdle(postCleanupRescanSession)
    refreshRescanRetryButton()
    unsubscribeProgress()
    unsubscribeItems()
    setScanning(false)
    lastScanProgress = null
    if (scanFailureItemCount !== null) {
      refreshTaskProgressUi(scanFailureItemCount)
    }
  }
}

async function handleScanButtonClick(): Promise<void> {
  if (scanning) {
    statusText.textContent = '正在停止扫描…'
    await window.diskClean.cancelScan()
    return
  }
  await startScan({ ordinaryScan: true, confirmRescan: true })
}

async function cleanSelected(): Promise<void> {
  if (!scanResult?.sessionId) return

  const selected = scanResult.items.filter((i) => candidateSelection.isSelected(i.id) && isSelectable(i))
  if (selected.length === 0) return

  const sessionInfo = await window.diskClean.getScanSessionInfo()
  if (!sessionInfo || sessionInfo.sessionId !== scanResult.sessionId) {
    statusText.textContent = '扫描会话已过期，请重新扫描后再清理'
    return
  }

  cleanBtn.disabled = true
  scanTaskPhase = 'executing'
  progress.hidden = false
  refreshTaskProgressUi(scanResult.items.length)
  statusText.textContent = '正在生成清理计划并校验…'

  let preview
  try {
    preview = await window.diskClean.prepareCleanup({
      sessionId: scanResult.sessionId,
      fingerprint: sessionInfo.fingerprint,
      candidateIds: selected.map((item) => item.id)
    })
  } catch (err) {
    restoreInteractiveTaskState(scanResult.items.length)
    statusText.textContent = `无法生成清理计划：${err instanceof Error ? err.message : String(err)}`
    updateSelectedSummary()
    return
  }

  const appClosedItems = selected.filter((item) => item.requiresAppClosed)
  const confirmed = await showConfirmDialog({
    title: '确认清理',
    message: `将 ${preview.itemCount} 项移入回收站（逻辑大小估算 ${formatSize(preview.estimatedLogicalBytes)}）`,
    details: [
      `建议清理 ${preview.recommendedCleanCount} 项 · 谨慎清理 ${preview.cautionCleanCount} 项`,
      ...preview.basisSummaries,
      appClosedItems.length > 0
        ? `${appClosedItems.length} 项需先关闭相关软件：${appClosedItems.map((item) => item.ruleName).join('、')}`
        : null,
      appClosedItems.length > 0 ? '请确认相关软件已关闭后再继续' : null,
      '执行方式：移入 Windows 回收站',
      '这些文件仍可能占用磁盘空间，清空回收站后才会真正释放',
      preview.rejectedCount > 0 ? `${preview.rejectedCount} 项未通过授权校验，不会执行` : null,
      '若路径自扫描后发生显著变化，将自动跳过而不强制执行'
    ].filter((line): line is string => Boolean(line))
  })
  if (!confirmed) {
    restoreInteractiveTaskState(scanResult.items.length)
    updateSelectedSummary()
    return
  }

  statusText.textContent = '正在移入回收站…'
  refreshTaskProgressUi(scanResult.items.length)

  let cleanupResult
  try {
    cleanupResult = await window.diskClean.executeConfirmedCleanup({
      confirmationId: preview.confirmationId
    })
  } catch (err) {
    restoreInteractiveTaskState(scanResult.items.length)
    statusText.textContent = `清理失败：${err instanceof Error ? err.message : String(err)}`
    updateSelectedSummary()
    return
  }

  taskPipelineState.advance('execute')

  const manifest = buildCleanupOutcomeManifest({
    sessionId: scanResult.sessionId,
    selectedItems: selected.map((item) => ({ id: item.id, path: item.path })),
    preview: {
      approvedCandidateIds: preview.approvedCandidateIds,
      rejectedAtPrepare: preview.rejectedAtPrepare
    },
    result: cleanupResult
  })
  const summary = formatCleanupOutcomeSummary(manifest)
  renderCleanupOutcomePanel(cleanupOutcomePanel, manifest)
  postCleanupRescanSession = beginPostCleanupRescanSession(postCleanupRescanSession, {
    cleanupOutcomeSummary: summary,
    pendingCleanupOutcome: manifest,
    drive: scanResult.drive
  })
  syncPersistentCleanupStatus()
  refreshRescanRetryButton()
  const rescanOptions = buildPostCleanupRescanScanOptions(postCleanupRescanSession)
  if (rescanOptions) {
    scanTaskPhase = 'rescanning'
    progress.hidden = false
    refreshTaskProgressUi(scanResult.items.length)
    await startScan(rescanOptions)
  } else {
    scanTaskPhase = 'completed'
    progress.hidden = true
    refreshTaskProgressUi(scanResult.items.length)
  }
  updateSelectedSummary()
}

scanBtn.addEventListener('click', () => {
  void handleScanButtonClick()
})
retryRescanBtn.addEventListener('click', () => {
  void startPostCleanupRescan()
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
    const profiles = await window.diskClean.listProviderProfiles()
    advanceToActionStep(activeProfileHasKey(profiles))
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
  await startScan({ drive: drive ?? driveSelect.value, confirmRescan: true, ordinaryScan: true })
}

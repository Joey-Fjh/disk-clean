/// <reference path="../preload/index.d.ts" />
import type { ScanResult } from '../shared/types'
import { activeProfileHasKey } from '../shared/provider-profile-utils'
import { preservePanelScrollTop } from './panel-scroll'
import { refreshRuleDraftPreview, renderUserFacingRulePreview } from './rule-knowledge-settings'
import { exitRuleExtensionMode, showCompleteStep, showPreviewStep, backToActionStep } from './rule-extension-mode'

let draftGeneration = 0
let draftBusy = false
let pendingDraftId: string | null = null

function statusEl(): HTMLElement | null {
  return document.getElementById('rule-draft-action-status')
}

function previewPanel(): HTMLElement | null {
  return document.getElementById('rule-extension-preview-panel')
}

function previewStatusEl(): HTMLElement | null {
  return document.getElementById('rule-extension-preview-status')
}

function enableBtn(): HTMLButtonElement | null {
  return document.getElementById('rule-extension-enable-btn') as HTMLButtonElement | null
}

function generateBtn(): HTMLButtonElement | null {
  return document.getElementById('generate-rule-draft-btn') as HTMLButtonElement | null
}

function exportBtn(): HTMLButtonElement | null {
  return document.getElementById('export-writing-pack-btn') as HTMLButtonElement | null
}

function importInlineBtn(): HTMLButtonElement | null {
  return document.getElementById('import-rule-draft-inline-btn') as HTMLButtonElement | null
}

export function renderInlineRulePreview(
  preview: Awaited<ReturnType<typeof refreshRuleDraftPreview>>,
  draftName: string,
  draftReason: string
): void {
  const panel = previewPanel()
  const enable = enableBtn()
  if (!panel) return
  panel.replaceChildren()
  panel.appendChild(renderUserFacingRulePreview(preview, { name: draftName, reason: draftReason }))
  if (enable) enable.disabled = !preview.approvable
}

export async function runEnablePendingDraft(): Promise<void> {
  if (!pendingDraftId || draftBusy) return
  draftBusy = true
  const status = previewStatusEl()
  if (status) status.textContent = '正在启用…'
  try {
    const result = await window.diskClean.confirmEnableRuleDraft(pendingDraftId)
    if (!result.ok) {
      if (status) status.textContent = result.message
      return
    }
    showCompleteStep('我的规则已启用。重新扫描后才会更新清理结果。')
    const rescanBtn = document.getElementById('rule-extension-rescan-btn')
    const laterBtn = document.getElementById('rule-extension-later-btn')
    if (rescanBtn) rescanBtn.hidden = false
    if (laterBtn) laterBtn.hidden = false
    pendingDraftId = null
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : '启用失败'
  } finally {
    draftBusy = false
  }
}

export function wireInlineRulePreviewActions(onRescan: () => void): void {
  document.getElementById('rule-extension-enable-btn')?.addEventListener('click', () => {
    void runEnablePendingDraft()
  })
  document.getElementById('rule-extension-preview-back')?.addEventListener('click', () => {
    pendingDraftId = null
    previewPanel()?.replaceChildren()
    backToActionStep()
  })
  document.getElementById('rule-extension-rescan-btn')?.addEventListener('click', () => {
    document.getElementById('rule-extension-rescan-btn')!.hidden = true
    document.getElementById('rule-extension-later-btn')!.hidden = true
    exitRuleExtensionMode()
    onRescan()
  })
  document.getElementById('rule-extension-later-btn')?.addEventListener('click', () => {
    document.getElementById('rule-extension-rescan-btn')!.hidden = true
    document.getElementById('rule-extension-later-btn')!.hidden = true
    exitRuleExtensionMode()
  })
}

export function updateRuleDraftActionState(options: {
  scanResult: ScanResult | null
  scanning: boolean
  ruleDraftSelectedIds: ReadonlySet<string>
  agentRunning?: boolean
  extensionStep?: 'select' | 'action' | 'preview' | 'complete' | 'idle'
}): void {
  const generate = generateBtn()
  const exportPack = exportBtn()
  const importInline = importInlineBtn()
  const status = statusEl()
  if (!generate || !exportPack) return

  const hasSession = Boolean(options.scanResult?.sessionId)
  const hasSelection = options.ruleDraftSelectedIds.size > 0
  const scanReady = hasSession && !options.scanning && options.scanResult?.cancelled !== true
  const inActionStep = options.extensionStep === 'action'

  generate.disabled = !inActionStep || !scanReady || !hasSelection || draftBusy || options.agentRunning === true
  exportPack.disabled = !inActionStep || !scanReady || !hasSelection || draftBusy
  if (importInline) importInline.disabled = !inActionStep || !scanReady || draftBusy

  if (!inActionStep) {
    if (status) status.textContent = ''
    return
  }

  if (!hasSession) {
    if (status) status.textContent = '完成扫描后，勾选候选项旁的「规则样本」以保存为我的规则'
  } else if (!hasSelection) {
    if (status) status.textContent = '请至少勾选一个「规则样本」（与清理勾选独立）'
  } else if (options.scanning) {
    if (status) status.textContent = '扫描进行中，暂不可用'
  }
}

export async function runGenerateRuleDraft(options: {
  scanResult: ScanResult
  ruleDraftSelectedIds: ReadonlySet<string>
  panelClean: HTMLElement
  onSuccess?: () => void
}): Promise<void> {
  if (draftBusy) return
  const sessionId = options.scanResult.sessionId
  const candidateIds = [...options.ruleDraftSelectedIds]
  if (candidateIds.length === 0) return

  draftBusy = true
  const generation = ++draftGeneration
  const status = statusEl()
  if (status) status.textContent = '正在生成我的规则…'
  updateRuleDraftActionState({
    scanResult: options.scanResult,
    scanning: false,
    ruleDraftSelectedIds: options.ruleDraftSelectedIds,
    extensionStep: 'action'
  })

  try {
    const profiles = await window.diskClean.listProviderProfiles()
    if (!activeProfileHasKey(profiles)) {
      if (status) status.textContent = '未配置模型。可导出规则资料，或前往设置配置 Provider。'
      return
    }

    const result = await window.diskClean.generateRuleDraft({ sessionId, candidateIds })
    if (generation !== draftGeneration) return

    const preview = await refreshRuleDraftPreview(result.draftId, sessionId)
    pendingDraftId = result.draftId
    const drafts = await window.diskClean.listRuleDrafts()
    const record = drafts.find((d) => d.id === result.draftId)
    renderInlineRulePreview(preview, record?.draft.name ?? '我的规则', record?.draft.reason ?? '')
    showPreviewStep()
    if (previewStatusEl()) {
      previewStatusEl()!.textContent = preview.approvable
        ? '预览完成，确认后可启用'
        : `不可启用：${preview.blockReason ?? '范围或安全校验未通过'}`
    }
    options.onSuccess?.()
  } catch (error) {
    if (generation !== draftGeneration) return
    const message = error instanceof Error ? error.message : '生成失败'
    if (status) status.textContent = `${message}。本地规则建议仍可使用。`
  } finally {
    draftBusy = false
    preservePanelScrollTop(options.panelClean, () => {
      updateRuleDraftActionState({
        scanResult: options.scanResult,
        scanning: false,
        ruleDraftSelectedIds: options.ruleDraftSelectedIds,
        extensionStep: 'preview'
      })
    })
  }
}

export async function runImportRuleDraftInline(options: {
  scanResult: ScanResult | null
  panelClean: HTMLElement
}): Promise<void> {
  const status = statusEl()
  if (status) status.textContent = '正在导入…'
  try {
    const result = await window.diskClean.importRuleDraft()
    if (!result.imported || !result.draft) {
      if (status) status.textContent = '未导入任何规则'
      return
    }
    if (options.scanResult?.sessionId) {
      const preview = await refreshRuleDraftPreview(result.draft.id, options.scanResult.sessionId)
      pendingDraftId = result.draft.id
      renderInlineRulePreview(preview, result.draft.draft.name, result.draft.draft.reason)
      showPreviewStep()
      if (previewStatusEl()) {
        previewStatusEl()!.textContent = preview.approvable
          ? '导入完成，确认后可启用'
          : `不可启用：${preview.blockReason ?? '范围或安全校验未通过'}`
      }
    } else {
      showCompleteStep('规则已导入。完成扫描后请预览并启用。')
    }
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : '导入失败'
  } finally {
    preservePanelScrollTop(options.panelClean, () => undefined)
  }
}

export async function runExportWritingPack(options: {
  scanResult: ScanResult
  ruleDraftSelectedIds: ReadonlySet<string>
}): Promise<void> {
  const status = statusEl()
  const candidateIds = [...options.ruleDraftSelectedIds]
  if (candidateIds.length === 0) return
  if (status) status.textContent = '正在导出规则资料…'
  try {
    const result = await window.diskClean.exportRuleWritingPack({
      sessionId: options.scanResult.sessionId,
      candidateIds
    })
    if (result.exported) {
      showCompleteStep('规则资料已导出。导入 JSON 后仍需预览并启用。')
    } else if (status) {
      status.textContent = '已取消导出'
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出失败'
    if (status) status.textContent = message
  }
}

export function wireRuleDraftActions(
  panelClean: HTMLElement,
  getState: () => {
    scanResult: ScanResult | null
    scanning: boolean
    ruleDraftSelectedIds: ReadonlySet<string>
    extensionStep: 'select' | 'action' | 'preview' | 'complete' | 'idle'
  },
  onRescan?: () => void
): void {
  if (onRescan) wireInlineRulePreviewActions(onRescan)

  generateBtn()?.addEventListener('click', () => {
    const state = getState()
    if (!state.scanResult) return
    void runGenerateRuleDraft({
      scanResult: state.scanResult,
      ruleDraftSelectedIds: state.ruleDraftSelectedIds,
      panelClean
    })
  })

  exportBtn()?.addEventListener('click', () => {
    const state = getState()
    if (!state.scanResult) return
    void runExportWritingPack({
      scanResult: state.scanResult,
      ruleDraftSelectedIds: state.ruleDraftSelectedIds
    })
  })

  importInlineBtn()?.addEventListener('click', () => {
    const state = getState()
    void runImportRuleDraftInline({ scanResult: state.scanResult, panelClean })
  })
}

export function resetRuleDraftActionUi(): void {
  draftGeneration += 1
  draftBusy = false
  pendingDraftId = null
  const status = statusEl()
  if (status) status.textContent = ''
  previewPanel()?.replaceChildren()
  if (previewStatusEl()) previewStatusEl()!.textContent = ''
}

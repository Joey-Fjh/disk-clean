/// <reference path="../preload/index.d.ts" />
import type { ScanResult } from '../shared/types'
import { preservePanelScrollTop } from './panel-scroll'
import { refreshRuleDraftPreview } from './rule-knowledge-settings'
import { showCompleteStep } from './rule-extension-mode'

let draftGeneration = 0
let draftBusy = false

function statusEl(): HTMLElement | null {
  return document.getElementById('rule-draft-action-status')
}

function generateBtn(): HTMLButtonElement | null {
  return document.getElementById('generate-rule-draft-btn') as HTMLButtonElement | null
}

function exportBtn(): HTMLButtonElement | null {
  return document.getElementById('export-writing-pack-btn') as HTMLButtonElement | null
}

export function updateRuleDraftActionState(options: {
  scanResult: ScanResult | null
  scanning: boolean
  ruleDraftSelectedIds: ReadonlySet<string>
  agentRunning?: boolean
  extensionStep?: 'select' | 'action' | 'complete' | 'idle'
}): void {
  const generate = generateBtn()
  const exportPack = exportBtn()
  const status = statusEl()
  if (!generate || !exportPack) return

  const hasSession = Boolean(options.scanResult?.sessionId)
  const hasSelection = options.ruleDraftSelectedIds.size > 0
  const scanReady = hasSession && !options.scanning && options.scanResult?.cancelled !== true
  const inActionStep = options.extensionStep === 'action'

  generate.disabled = !inActionStep || !scanReady || !hasSelection || draftBusy || options.agentRunning === true
  exportPack.disabled = !inActionStep || !scanReady || !hasSelection || draftBusy

  if (!inActionStep) {
    if (status) status.textContent = ''
    return
  }

  if (!hasSession) {
    if (status) status.textContent = '完成扫描后，勾选候选项旁的「规则样本」以生成识别规则'
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
  if (status) status.textContent = '正在生成识别规则…'
  updateRuleDraftActionState({
    scanResult: options.scanResult,
    scanning: false,
    ruleDraftSelectedIds: options.ruleDraftSelectedIds,
    extensionStep: 'action'
  })

  try {
    const hasProvider = await window.diskClean.getProviderConfig()
    if (!hasProvider?.hasKey) {
      if (status) status.textContent = '未配置模型。可导出规则资料，或前往设置配置 Provider。'
      return
    }

    const result = await window.diskClean.generateRuleDraft({ sessionId, candidateIds })
    if (generation !== draftGeneration) return

    await refreshRuleDraftPreview(result.draftId, sessionId)
    showCompleteStep('识别规则已生成，请前往扩展规则管理预览并启用。尚未获得清理权限。')
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
        extensionStep: 'action'
      })
    })
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

export function wireRuleDraftActions(panelClean: HTMLElement, getState: () => {
  scanResult: ScanResult | null
  scanning: boolean
  ruleDraftSelectedIds: ReadonlySet<string>
  extensionStep: 'select' | 'action' | 'complete' | 'idle'
}): void {
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
}

export function resetRuleDraftActionUi(): void {
  draftGeneration += 1
  draftBusy = false
  const status = statusEl()
  if (status) status.textContent = ''
}

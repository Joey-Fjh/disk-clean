import { PROVIDER_PRESETS, PROVIDER_PROTOCOL_LABELS } from '../shared/provider-types'
import type { ProviderConfigPublic, ProviderId } from '../shared/provider-types'
import { canRunProviderTests, isProviderFormDirty } from './provider-form-state'
import { formatProviderSummary } from './settings-summaries'
import { SubTabGroup, applySubTabDom } from './sub-tab-group'

const providerSelect = document.getElementById('provider-select') as HTMLSelectElement
const protocolInput = document.getElementById('provider-protocol') as HTMLInputElement
const baseUrlInput = document.getElementById('provider-base-url') as HTMLInputElement
const modelInput = document.getElementById('provider-model') as HTMLInputElement
const apiKeyInput = document.getElementById('provider-api-key') as HTMLInputElement
const keyHint = document.getElementById('provider-key-hint') as HTMLSpanElement
const saveBtn = document.getElementById('provider-save-btn') as HTMLButtonElement
const deleteKeyBtn = document.getElementById('provider-delete-key-btn') as HTMLButtonElement
const testConnectionBtn = document.getElementById('provider-test-connection-btn') as HTMLButtonElement
const testCapabilityBtn = document.getElementById('provider-test-capability-btn') as HTMLButtonElement
const configStatusEl = document.getElementById('provider-config-status') as HTMLParagraphElement
const testStatusEl = document.getElementById('provider-test-status') as HTMLParagraphElement
const dirtyHintEl = document.getElementById('provider-dirty-hint') as HTMLParagraphElement
const savedSummaryEl = document.getElementById('provider-saved-summary') as HTMLElement
const providerCardSummary = document.getElementById('provider-card-summary') as HTMLSpanElement
const providerCardBody = document.getElementById('settings-card-provider-body') as HTMLElement

const providerSubTabs = new SubTabGroup(
  [
    { id: 'config', label: '连接配置' },
    { id: 'test', label: '连接测试' }
  ],
  'config'
)

let testing = false
let savedConfig: ProviderConfigPublic | null = null

function setConfigStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void {
  configStatusEl.textContent = message
  configStatusEl.dataset.tone = tone
}

function setTestStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void {
  testStatusEl.textContent = message
  testStatusEl.dataset.tone = tone
}

function presetFor(id: ProviderId) {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0]
}

export function currentProviderFormValues() {
  return {
    providerId: providerSelect.value as ProviderId,
    baseUrl: baseUrlInput.value,
    model: modelInput.value,
    apiKey: apiKeyInput.value
  }
}

function applyKeyHint(config: ProviderConfigPublic | null): void {
  if (config?.hasKey && config.keyLastFour) {
    keyHint.hidden = false
    keyHint.textContent = `已配置，末四位 ****${config.keyLastFour}`
  } else {
    keyHint.hidden = true
    keyHint.textContent = ''
  }
}

function renderSavedSummary(config: ProviderConfigPublic | null): void {
  if (!config) {
    savedSummaryEl.innerHTML = '<p class="provider-hint">尚未保存模型配置</p>'
    return
  }
  const keyText = config.hasKey
    ? `已配置 · ****${config.keyLastFour ?? '????'}`
    : '未配置 API Key'
  savedSummaryEl.innerHTML = `
    <div><dt>Provider</dt><dd>${config.providerId}</dd></div>
    <div><dt>Base URL</dt><dd>${config.baseUrl}</dd></div>
    <div><dt>模型</dt><dd>${config.model || '—'}</dd></div>
    <div><dt>API Key</dt><dd>${keyText}</dd></div>
  `
}

function updateProviderCardSummary(config: ProviderConfigPublic | null): void {
  providerCardSummary.textContent = formatProviderSummary(config)
}

export function updateTestButtonState(): void {
  const dirty = isProviderFormDirty(currentProviderFormValues(), savedConfig)
  const canTest = canRunProviderTests(currentProviderFormValues(), savedConfig, testing)
  testConnectionBtn.disabled = !canTest
  testCapabilityBtn.disabled = !canTest
  dirtyHintEl.hidden = !dirty
  testConnectionBtn.title = dirty ? '请先保存配置' : ''
  testCapabilityBtn.title = dirty ? '请先保存配置' : ''
}

export function fillProviderForm(config: ProviderConfigPublic | null): void {
  const providerId = config?.providerId ?? 'openai'
  providerSelect.value = providerId
  protocolInput.value = PROVIDER_PROTOCOL_LABELS[config?.protocol ?? 'openai-chat-completions']
  baseUrlInput.value = config?.baseUrl ?? presetFor(providerId).defaultBaseUrl
  modelInput.value = config?.model ?? ''
  apiKeyInput.value = ''
  applyKeyHint(config)
  savedConfig = config
  renderSavedSummary(config)
  updateProviderCardSummary(config)
  updateTestButtonState()
}

function onProviderChange(): void {
  const id = providerSelect.value as ProviderId
  const preset = presetFor(id)
  protocolInput.value = PROVIDER_PROTOCOL_LABELS[preset.protocol]
  if (!baseUrlInput.value.trim() || PROVIDER_PRESETS.some((p) => p.defaultBaseUrl === baseUrlInput.value.trim())) {
    baseUrlInput.value = preset.defaultBaseUrl
  }
  updateTestButtonState()
}

function setTesting(active: boolean): void {
  testing = active
  saveBtn.disabled = active
  deleteKeyBtn.disabled = active
  updateTestButtonState()
}

function wireProviderSubTabs(): void {
  providerCardBody.querySelectorAll<HTMLButtonElement>('[data-provider-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.providerTab
      if (!tabId) return
      providerSubTabs.activate(tabId)
      applySubTabDom(providerCardBody, providerSubTabs, { panelAttr: 'data-subtab-panel' })
      providerCardBody.querySelectorAll<HTMLButtonElement>('[data-provider-tab]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.providerTab === tabId)
      })
    })
  })
}

async function loadProviderSettings(): Promise<void> {
  const config = await window.diskClean.getProviderConfig()
  fillProviderForm(config)
  setConfigStatus(config?.hasKey ? '模型连接已配置' : '尚未配置 API Key')
}

for (const el of [providerSelect, baseUrlInput, modelInput, apiKeyInput]) {
  el.addEventListener('input', updateTestButtonState)
  el.addEventListener('change', updateTestButtonState)
}

providerSelect.addEventListener('change', onProviderChange)

saveBtn.addEventListener('click', async () => {
  setTesting(true)
  setConfigStatus('正在保存…')
  try {
    const config = await window.diskClean.saveProviderConfig({
      providerId: providerSelect.value as ProviderId,
      baseUrl: baseUrlInput.value,
      model: modelInput.value,
      apiKey: apiKeyInput.value.trim() || undefined
    })
    fillProviderForm(config)
    setConfigStatus('配置已保存', 'success')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setConfigStatus(`保存失败：${message}`, 'error')
  } finally {
    setTesting(false)
  }
})

deleteKeyBtn.addEventListener('click', async () => {
  if (!confirm('确认删除已保存的 API Key？')) return
  setTesting(true)
  setConfigStatus('正在删除 Key…')
  try {
    const config = await window.diskClean.deleteProviderApiKey()
    fillProviderForm(config)
    setConfigStatus('API Key 已删除', 'success')
  } catch (err) {
    setConfigStatus(`删除失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    setTesting(false)
  }
})

testConnectionBtn.addEventListener('click', async () => {
  if (testing || !canRunProviderTests(currentProviderFormValues(), savedConfig, testing)) return
  setTesting(true)
  setTestStatus('正在测试连接…')
  try {
    const result = await window.diskClean.testProviderConnection()
    if (result.success) {
      setTestStatus(`连接成功（${result.latencyMs ?? 0} ms）`, 'success')
    } else {
      setTestStatus(result.message ?? '连接失败', 'error')
    }
  } catch (err) {
    setTestStatus(`连接失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    setTesting(false)
  }
})

testCapabilityBtn.addEventListener('click', async () => {
  if (testing || !canRunProviderTests(currentProviderFormValues(), savedConfig, testing)) return
  setTesting(true)
  setTestStatus('正在测试模型能力…')
  try {
    const result = await window.diskClean.testProviderCapability()
    if (result.success) {
      setTestStatus(`能力测试通过（${result.latencyMs ?? 0} ms）`, 'success')
    } else {
      setTestStatus(result.message ?? '能力测试失败', 'error')
    }
  } catch (err) {
    setTestStatus(`能力测试失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    setTesting(false)
  }
})

wireProviderSubTabs()
void loadProviderSettings()

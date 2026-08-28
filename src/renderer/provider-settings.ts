import { PROVIDER_PRESETS, PROVIDER_PROTOCOL_LABELS } from '../shared/provider-types'
import type { ProviderId, ProviderProfilePublic, ProviderProfilesPublicState } from '../shared/provider-types'
import {
  isProviderFormDirty,
  presetLabel,
  requiresKeyReentry
} from './provider-form-state'
import type { ProviderFormValues } from './provider-form-state'
import { renderProfileList } from './provider-profile-render'
import { ProviderTestState } from './provider-test-state'
import { formatProviderSummary } from './settings-summaries'

const profileListEl = document.getElementById('provider-profile-list') as HTMLElement
const formSectionEl = document.getElementById('provider-form-section') as HTMLElement
const listSectionEl = document.getElementById('provider-list-section') as HTMLElement
const formTitleEl = document.getElementById('provider-form-title') as HTMLHeadingElement
const nameInput = document.getElementById('provider-name') as HTMLInputElement
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement
const protocolInput = document.getElementById('provider-protocol') as HTMLInputElement
const baseUrlInput = document.getElementById('provider-base-url') as HTMLInputElement
const modelInput = document.getElementById('provider-model') as HTMLInputElement
const apiKeyInput = document.getElementById('provider-api-key') as HTMLInputElement
const keyHint = document.getElementById('provider-key-hint') as HTMLSpanElement
const keyReentryHint = document.getElementById('provider-key-reentry-hint') as HTMLParagraphElement
const saveBtn = document.getElementById('provider-save-btn') as HTMLButtonElement
const cancelEditBtn = document.getElementById('provider-cancel-edit-btn') as HTMLButtonElement
const addProfileBtn = document.getElementById('provider-add-profile-btn') as HTMLButtonElement
const configStatusEl = document.getElementById('provider-config-status') as HTMLParagraphElement
const dirtyHintEl = document.getElementById('provider-dirty-hint') as HTMLParagraphElement
const providerCardSummary = document.getElementById('provider-card-summary') as HTMLSpanElement

let profilesState: ProviderProfilesPublicState = { activeProfileId: null, profiles: [] }
let editingProfileId: string | null = null
let savedEditingProfile: ProviderProfilePublic | null = null
const providerTestState = new ProviderTestState()

function presetFor(id: ProviderId) {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0]
}

export function currentProviderFormValues(): ProviderFormValues {
  return {
    name: nameInput.value,
    providerId: providerSelect.value as ProviderId,
    baseUrl: baseUrlInput.value,
    model: modelInput.value,
    apiKey: apiKeyInput.value
  }
}

function setConfigStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void {
  configStatusEl.textContent = message
  configStatusEl.dataset.tone = tone
}

function applyKeyHint(profile: ProviderProfilePublic | null): void {
  if (profile?.hasKey && profile.keyLastFour) {
    keyHint.hidden = false
    keyHint.textContent = `已配置，末四位 ****${profile.keyLastFour}`
  } else {
    keyHint.hidden = true
    keyHint.textContent = ''
  }
}

function updateDirtyHint(): void {
  const dirty = isProviderFormDirty(currentProviderFormValues(), savedEditingProfile)
  dirtyHintEl.hidden = !dirty
  const needsReentry = requiresKeyReentry(currentProviderFormValues(), savedEditingProfile)
  keyReentryHint.hidden = !needsReentry
}

function updateProviderCardSummary(): void {
  providerCardSummary.textContent = formatProviderSummary(profilesState)
}

function renderProfiles(): void {
  renderProfileList(profileListEl, profilesState.profiles, {
    onUse: (profileId) => void handleSetActive(profileId),
    onEdit: (profileId) => showFormView(profileId),
    onTestConnection: (profileId) => void handleTestConnection(profileId),
    onTestCapability: (profileId) => void handleTestCapability(profileId),
    onDelete: (profileId, name) => void handleDelete(profileId, name),
    testingProfileIds: providerTestState.getTestingProfileIds(),
    lastTestStatus: providerTestState.getLastTestStatusMap()
  })
}

function showListView(): void {
  editingProfileId = null
  savedEditingProfile = null
  listSectionEl.hidden = false
  formSectionEl.hidden = true
  updateProviderCardSummary()
  renderProfiles()
}

function showFormView(profileId: string): void {
  if (profileId && providerTestState.isTesting(profileId)) {
    setConfigStatus('该配置正在测试中，请等待完成', 'error')
    return
  }

  editingProfileId = profileId || null
  listSectionEl.hidden = true
  formSectionEl.hidden = false

  if (profileId) {
    const profile = profilesState.profiles.find((p) => p.id === profileId) ?? null
    savedEditingProfile = profile
    formTitleEl.textContent = '编辑配置'
    if (!profile) {
      setConfigStatus('未找到配置', 'error')
      showListView()
      return
    }
    nameInput.value = profile.name
    providerSelect.value = profile.providerId
    protocolInput.value = PROVIDER_PROTOCOL_LABELS[profile.protocol]
    baseUrlInput.value = profile.baseUrl
    modelInput.value = profile.model
    apiKeyInput.value = ''
    applyKeyHint(profile)
  } else {
    savedEditingProfile = null
    formTitleEl.textContent = '添加配置'
    const providerId = 'openai' as ProviderId
    providerSelect.value = providerId
    protocolInput.value = PROVIDER_PROTOCOL_LABELS[presetFor(providerId).protocol]
    baseUrlInput.value = presetFor(providerId).defaultBaseUrl
    modelInput.value = ''
    nameInput.value = ''
    apiKeyInput.value = ''
    keyHint.hidden = true
    keyHint.textContent = ''
  }

  updateDirtyHint()
  setConfigStatus('')
}

async function refreshProfiles(): Promise<void> {
  profilesState = await window.diskClean.listProviderProfiles()
  updateProviderCardSummary()
  if (formSectionEl.hidden) {
    renderProfiles()
  }
}

async function handleSetActive(profileId: string): Promise<void> {
  if (providerTestState.isTesting(profileId)) return
  try {
    profilesState = await window.diskClean.setActiveProviderProfile(profileId)
    updateProviderCardSummary()
    renderProfiles()
    setConfigStatus('已切换当前配置', 'success')
  } catch (err) {
    setConfigStatus(`切换失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

async function handleDelete(profileId: string, name: string): Promise<void> {
  if (providerTestState.isTesting(profileId)) return
  if (!confirm(`确认删除配置“${name}”及其已保存 API Key？`)) return
  providerTestState.invalidateProfile(profileId)
  try {
    profilesState = await window.diskClean.deleteProviderProfile(profileId)
    updateProviderCardSummary()
    renderProfiles()
    setConfigStatus('配置已删除', 'success')
  } catch (err) {
    setConfigStatus(`删除失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

async function handleSave(): Promise<void> {
  const form = currentProviderFormValues()
  const savedProfileId = editingProfileId
  if (savedProfileId && providerTestState.isTesting(savedProfileId)) {
    setConfigStatus('该配置正在测试中，请等待完成后再保存', 'error')
    return
  }

  saveBtn.disabled = true
  setConfigStatus('正在保存…')
  try {
    if (editingProfileId) {
      profilesState = await window.diskClean.updateProviderProfile({
        profileId: editingProfileId,
        name: form.name,
        providerId: form.providerId,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey.trim() || undefined
      })
      providerTestState.invalidateProfile(editingProfileId)
    } else {
      profilesState = await window.diskClean.createProviderProfile({
        name: form.name,
        providerId: form.providerId,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey.trim() || undefined
      })
    }
    updateProviderCardSummary()
    showListView()
    setConfigStatus('配置已保存', 'success')
  } catch (err) {
    setConfigStatus(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    saveBtn.disabled = false
  }
}

async function handleTestConnection(profileId: string): Promise<void> {
  const profile = profilesState.profiles.find((p) => p.id === profileId)
  if (!profile || providerTestState.isTesting(profileId)) return
  if (editingProfileId === profileId && isProviderFormDirty(currentProviderFormValues(), profile)) {
    setConfigStatus('请先保存配置再测试', 'error')
    return
  }

  const generation = providerTestState.beginTest(profileId, '正在测试连接…')
  renderProfiles()
  try {
    const result = await window.diskClean.testProviderConnection(profileId)
    providerTestState.completeTest(profileId, generation, {
      message: result.success
        ? `连接成功（${result.latencyMs ?? 0} ms）`
        : (result.message ?? '连接失败'),
      tone: result.success ? 'success' : 'error'
    })
  } catch (err) {
    providerTestState.completeTest(profileId, generation, {
      message: `连接失败：${err instanceof Error ? err.message : String(err)}`,
      tone: 'error'
    })
  } finally {
    renderProfiles()
  }
}

async function handleTestCapability(profileId: string): Promise<void> {
  const profile = profilesState.profiles.find((p) => p.id === profileId)
  if (!profile || providerTestState.isTesting(profileId)) return
  if (editingProfileId === profileId && isProviderFormDirty(currentProviderFormValues(), profile)) {
    setConfigStatus('请先保存配置再测试', 'error')
    return
  }

  const generation = providerTestState.beginTest(profileId, '正在测试模型能力…')
  renderProfiles()
  try {
    const result = await window.diskClean.testProviderCapability(profileId)
    providerTestState.completeTest(profileId, generation, {
      message: result.success
        ? `能力测试通过（${result.latencyMs ?? 0} ms）`
        : (result.message ?? '能力测试失败'),
      tone: result.success ? 'success' : 'error'
    })
  } catch (err) {
    providerTestState.completeTest(profileId, generation, {
      message: `能力测试失败：${err instanceof Error ? err.message : String(err)}`,
      tone: 'error'
    })
  } finally {
    renderProfiles()
  }
}

function onProviderChange(): void {
  const id = providerSelect.value as ProviderId
  const preset = presetFor(id)
  protocolInput.value = PROVIDER_PROTOCOL_LABELS[preset.protocol]
  if (!baseUrlInput.value.trim() || PROVIDER_PRESETS.some((p) => p.defaultBaseUrl === baseUrlInput.value.trim())) {
    baseUrlInput.value = preset.defaultBaseUrl
  }
  updateDirtyHint()
}

for (const el of [nameInput, providerSelect, baseUrlInput, modelInput, apiKeyInput]) {
  el.addEventListener('input', updateDirtyHint)
  el.addEventListener('change', updateDirtyHint)
}

providerSelect.addEventListener('change', onProviderChange)
saveBtn.addEventListener('click', () => void handleSave())
cancelEditBtn.addEventListener('click', () => showListView())
addProfileBtn.addEventListener('click', () => showFormView(''))

void refreshProfiles().then(() => {
  showListView()
  const active = profilesState.profiles.find((p) => p.id === profilesState.activeProfileId)
  if (active?.hasKey) {
    setConfigStatus(`当前使用：${active.name}（${presetLabel(active.providerId)}）`)
  } else if (profilesState.profiles.length > 0) {
    setConfigStatus('请选择并配置 API Key')
  } else {
    setConfigStatus('尚未添加模型配置')
  }
})

export { refreshProfiles as refreshProviderProfiles, providerTestState }

import { app, safeStorage } from 'electron'
import { join } from 'path'
import type {
  CreateProviderProfileInput,
  ProviderConfigPublic,
  ProviderProfilePublic,
  ProviderProfilesPublicState,
  ProviderTestResult,
  SaveProviderConfigInput,
  UpdateProviderProfileInput
} from '../../shared/provider-types'
import { ProviderConfigStore, type SafeStorageAdapter } from './provider-config-store'
import { chatCompletion } from './provider-client'
import { ProviderError, toProviderTestError } from './provider-errors'

const CONNECTION_TEST_MESSAGE = 'ping'
const CAPABILITY_TEST_PROMPT =
  'Reply with only this JSON object and no other text: {"status":"ok","source":"disk-clean"}'

function createElectronSafeStorageAdapter(): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plainText) => safeStorage.encryptString(plainText),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted)
  }
}

let storeInstance: ProviderConfigStore | null = null

export function getProviderConfigPath(): string {
  return join(app.getPath('userData'), 'config', 'provider-config.json')
}

export function createProviderConfigStore(
  configPath?: string,
  safeStorageAdapter?: SafeStorageAdapter
): ProviderConfigStore {
  return new ProviderConfigStore({
    configPath: configPath ?? getProviderConfigPath(),
    safeStorage: safeStorageAdapter ?? createElectronSafeStorageAdapter()
  })
}

export function getProviderStore(): ProviderConfigStore {
  if (!storeInstance) {
    storeInstance = createProviderConfigStore()
  }
  return storeInstance
}

/** 测试注入用 */
export function setProviderStoreForTests(store: ProviderConfigStore | null): void {
  storeInstance = store
}

function profileToLegacyPublic(profile: ProviderProfilePublic): ProviderConfigPublic {
  return {
    providerId: profile.providerId,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.model,
    hasKey: profile.hasKey,
    keyLastFour: profile.keyLastFour
  }
}

export function listProviderProfiles(): ProviderProfilesPublicState {
  return getProviderStore().listProfilesPublic()
}

export function getActiveProviderProfile(): ProviderProfilePublic | null {
  return getProviderStore().getActiveProfilePublic()
}

/** Agent 与兼容层：返回当前启用配置的公开字段（不含 Key）。 */
export function getProviderConfig(): ProviderConfigPublic | null {
  const active = getActiveProviderProfile()
  return active ? profileToLegacyPublic(active) : null
}

export function createProviderProfile(input: CreateProviderProfileInput): ProviderProfilesPublicState {
  if (!input || typeof input !== 'object') {
    throw new ProviderError('INVALID_INPUT', '配置无效')
  }
  return getProviderStore().createProfile(input)
}

export function updateProviderProfile(input: UpdateProviderProfileInput): ProviderProfilesPublicState {
  if (!input || typeof input !== 'object') {
    throw new ProviderError('INVALID_INPUT', '配置无效')
  }
  return getProviderStore().updateProfile(input)
}

export function deleteProviderProfile(profileId: string): ProviderProfilesPublicState {
  return getProviderStore().deleteProfile(profileId)
}

export function setActiveProviderProfile(profileId: string): ProviderProfilesPublicState {
  return getProviderStore().setActiveProfile(profileId)
}

/** 测试辅助：创建或更新当前启用配置。 */
export function saveProviderConfig(input: SaveProviderConfigInput): ProviderConfigPublic {
  const state = listProviderProfiles()
  const active = state.profiles.find((p) => p.id === state.activeProfileId)
  if (active) {
    const next = updateProviderProfile({
      profileId: active.id,
      name: active.name,
      providerId: input.providerId,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey
    })
    const updated = next.profiles.find((p) => p.id === next.activeProfileId)
    if (!updated) throw new ProviderError('CONFIG_MISSING', '未找到可用的模型配置')
    return profileToLegacyPublic(updated)
  }

  const created = createProviderProfile({
    name: '测试配置',
    providerId: input.providerId,
    baseUrl: input.baseUrl,
    model: input.model,
    apiKey: input.apiKey
  })
  const profile = created.profiles.find((p) => p.id === created.activeProfileId)
  if (!profile) throw new ProviderError('CONFIG_MISSING', '未找到可用的模型配置')
  return profileToLegacyPublic(profile)
}

export function requireRunnableConfig(profileId?: string): {
  config: ProviderConfigPublic
  apiKey: string
  profileId: string
} {
  const state = listProviderProfiles()
  const id = profileId ?? state.activeProfileId
  if (!id) {
    throw new ProviderError('CONFIG_MISSING', '请先保存完整的模型配置和 API Key')
  }
  const profile = state.profiles.find((p) => p.id === id)
  if (!profile) {
    throw new ProviderError('PROFILE_NOT_FOUND', '未找到指定的模型配置')
  }
  if (!profile.hasKey || !profile.model.trim() || !profile.baseUrl.trim()) {
    throw new ProviderError('CONFIG_MISSING', '请先保存完整的模型配置和 API Key')
  }
  const apiKey = getProviderStore().getDecryptedApiKey(id)
  if (!apiKey) {
    throw new ProviderError('CONFIG_MISSING', '未找到可用的 API Key')
  }
  return { config: profileToLegacyPublic(profile), apiKey, profileId: id }
}

export async function testProviderConnection(
  profileId: string,
  fetchFn?: typeof fetch
): Promise<ProviderTestResult> {
  try {
    const { config, apiKey } = requireRunnableConfig(profileId)
    const result = await chatCompletion({
      baseUrl: config.baseUrl,
      apiKey,
      model: config.model,
      messages: [{ role: 'user', content: CONNECTION_TEST_MESSAGE }],
      maxTokens: 8,
      timeoutMs: 12_000,
      fetchFn
    })
    return {
      success: true,
      latencyMs: result.latencyMs,
      providerId: config.providerId,
      model: config.model
    }
  } catch (error) {
    const mapped = toProviderTestError(error)
    return {
      success: false,
      errorCode: mapped.code,
      message: mapped.message
    }
  }
}

function parseCapabilityJson(text: string): boolean {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const candidate = fenced ? fenced[1].trim() : trimmed
  try {
    const parsed = JSON.parse(candidate) as { status?: string; source?: string }
    return parsed.status === 'ok' && parsed.source === 'disk-clean'
  } catch {
    return false
  }
}

export async function testProviderCapability(
  profileId: string,
  fetchFn?: typeof fetch
): Promise<ProviderTestResult> {
  try {
    const { config, apiKey } = requireRunnableConfig(profileId)
    const result = await chatCompletion({
      baseUrl: config.baseUrl,
      apiKey,
      model: config.model,
      messages: [{ role: 'user', content: CAPABILITY_TEST_PROMPT }],
      maxTokens: 64,
      timeoutMs: 20_000,
      fetchFn
    })
    const ok = parseCapabilityJson(result.content)
    return {
      success: ok,
      latencyMs: result.latencyMs,
      providerId: config.providerId,
      model: config.model,
      capability: ok ? 'ok' : 'invalid_json',
      message: ok ? '模型可返回有效 JSON' : '模型返回的内容无法解析为预期 JSON'
    }
  } catch (error) {
    const mapped = toProviderTestError(error)
    return {
      success: false,
      errorCode: mapped.code,
      message: mapped.message,
      capability: 'failed'
    }
  }
}

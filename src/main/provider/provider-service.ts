import { app, safeStorage } from 'electron'
import { join } from 'path'
import type {
  ProviderConfigPublic,
  ProviderTestResult,
  SaveProviderConfigInput
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

export function getProviderConfig(): ProviderConfigPublic | null {
  return getProviderStore().getPublicConfig()
}

export function saveProviderConfig(input: SaveProviderConfigInput): ProviderConfigPublic {
  if (!input || typeof input !== 'object') {
    throw new ProviderError('INVALID_INPUT', '配置无效')
  }
  return getProviderStore().saveConfig({
    providerId: input.providerId,
    baseUrl: input.baseUrl,
    model: input.model,
    apiKey: input.apiKey
  })
}

export function deleteProviderApiKey(): ProviderConfigPublic | null {
  return getProviderStore().deleteApiKey()
}

export function requireRunnableConfig(): { config: ProviderConfigPublic; apiKey: string } {
  const config = getProviderStore().getPublicConfig()
  if (!config?.hasKey || !config.model.trim() || !config.baseUrl.trim()) {
    throw new ProviderError('CONFIG_MISSING', '请先保存完整的模型配置和 API Key')
  }
  const apiKey = getProviderStore().getDecryptedApiKey()
  if (!apiKey) {
    throw new ProviderError('CONFIG_MISSING', '未找到可用的 API Key')
  }
  return { config, apiKey }
}

export async function testProviderConnection(
  fetchFn?: typeof fetch
): Promise<ProviderTestResult> {
  try {
    const { config, apiKey } = requireRunnableConfig()
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
  fetchFn?: typeof fetch
): Promise<ProviderTestResult> {
  try {
    const { config, apiKey } = requireRunnableConfig()
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

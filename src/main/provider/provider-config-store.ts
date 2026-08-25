import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ProviderId, ProviderProtocol, ProviderConfigPublic } from '../../shared/provider-types'
import { PROVIDER_PRESETS } from '../../shared/provider-types'
import { PROVIDER_INPUT_LIMITS } from '../../shared/provider-limits'
import { ProviderError } from './provider-errors'
import { normalizeProviderBaseUrl, providerOriginFromBaseUrl } from './provider-url'
import { assertKeyOriginCompatible, deriveStoredKeyOrigin } from './provider-key-origin'

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

interface StoredProviderConfig {
  providerId: ProviderId
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  encryptedApiKey?: string
  keyLastFour?: string
  /** API Key 绑定的规范化 Origin（scheme + host + port）。 */
  keyOrigin?: string
}

export interface ProviderConfigStoreOptions {
  configPath: string
  safeStorage: SafeStorageAdapter
}

function ensureParentDir(filePath: string): void {
  const dir = join(filePath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readStored(filePath: string): StoredProviderConfig | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as StoredProviderConfig
  } catch {
    return null
  }
}

function writeStored(filePath: string, config: StoredProviderConfig): void {
  ensureParentDir(filePath)
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
}

function lastFour(key: string): string {
  return key.length <= 4 ? key : key.slice(-4)
}

function validateProviderId(providerId: string): ProviderId {
  if (providerId === 'openai' || providerId === 'deepseek' || providerId === 'custom') {
    return providerId
  }
  throw new ProviderError('INVALID_INPUT', '未知的 Provider')
}

function validateRawBaseUrl(raw: string): void {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ProviderError('INVALID_URL', 'Base URL 不能为空')
  }
  if (raw.length > PROVIDER_INPUT_LIMITS.BASE_URL_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', 'Base URL 过长')
  }
}

function validateModel(model: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed.length > PROVIDER_INPUT_LIMITS.MODEL_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', '模型名称无效')
  }
  return trimmed
}

function validateApiKey(apiKey: string): string {
  const trimmed = apiKey.trim()
  if (!trimmed || trimmed.length > PROVIDER_INPUT_LIMITS.API_KEY_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', 'API Key 无效')
  }
  return trimmed
}

export class ProviderConfigStore {
  private readonly configPath: string
  private readonly safeStorage: SafeStorageAdapter

  constructor(options: ProviderConfigStoreOptions) {
    this.configPath = options.configPath
    this.safeStorage = options.safeStorage
  }

  getPublicConfig(): ProviderConfigPublic | null {
    const stored = readStored(this.configPath)
    if (!stored) return null
    return {
      providerId: stored.providerId,
      protocol: stored.protocol,
      baseUrl: stored.baseUrl,
      model: stored.model,
      hasKey: Boolean(stored.encryptedApiKey),
      keyLastFour: stored.keyLastFour
    }
  }

  getDecryptedApiKey(): string | null {
    const stored = readStored(this.configPath)
    if (!stored?.encryptedApiKey) return null
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new ProviderError('SAFE_STORAGE_UNAVAILABLE', '系统安全存储不可用，无法读取 API Key')
    }
    const encrypted = Buffer.from(stored.encryptedApiKey, 'base64')
    return this.safeStorage.decryptString(encrypted)
  }

  saveConfig(input: {
    providerId: ProviderId
    baseUrl: string
    model: string
    apiKey?: string
  }): ProviderConfigPublic {
    const providerId = validateProviderId(input.providerId)
    validateRawBaseUrl(input.baseUrl)
    const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
    const newOrigin = providerOriginFromBaseUrl(baseUrl)
    const model = validateModel(input.model)
    const preset = PROVIDER_PRESETS.find((p) => p.id === providerId)
    const protocol: ProviderProtocol = preset?.protocol ?? 'openai-chat-completions'

    const existing = readStored(this.configPath)
    let encryptedApiKey = existing?.encryptedApiKey
    let keyLastFour = existing?.keyLastFour
    let keyOrigin = existing?.keyOrigin

    const incomingKey = input.apiKey?.trim()
    if (incomingKey) {
      const validatedKey = validateApiKey(incomingKey)
      if (!this.safeStorage.isEncryptionAvailable()) {
        throw new ProviderError(
          'SAFE_STORAGE_UNAVAILABLE',
          '系统安全存储不可用，无法保存 API Key。请检查 Windows 凭据保护或域策略。'
        )
      }
      const encrypted = this.safeStorage.encryptString(validatedKey)
      encryptedApiKey = encrypted.toString('base64')
      keyLastFour = lastFour(validatedKey)
      keyOrigin = newOrigin
    } else if (existing?.encryptedApiKey) {
      const boundOrigin = deriveStoredKeyOrigin(existing.baseUrl, existing.keyOrigin)
      assertKeyOriginCompatible(boundOrigin, newOrigin)
      keyOrigin = boundOrigin
    }

    const stored: StoredProviderConfig = {
      providerId,
      protocol,
      baseUrl,
      model,
      encryptedApiKey,
      keyLastFour,
      keyOrigin: encryptedApiKey ? keyOrigin : undefined
    }
    writeStored(this.configPath, stored)

    return {
      providerId,
      protocol,
      baseUrl,
      model,
      hasKey: Boolean(encryptedApiKey),
      keyLastFour
    }
  }

  deleteApiKey(): ProviderConfigPublic | null {
    const stored = readStored(this.configPath)
    if (!stored) return null
    const next: StoredProviderConfig = {
      ...stored,
      encryptedApiKey: undefined,
      keyLastFour: undefined,
      keyOrigin: undefined
    }
    writeStored(this.configPath, next)
    return {
      providerId: next.providerId,
      protocol: next.protocol,
      baseUrl: next.baseUrl,
      model: next.model,
      hasKey: false
    }
  }

  /** 测试用：写入磁盘原始内容。 */
  writeRawStoredForTests(config: StoredProviderConfig): void {
    writeStored(this.configPath, config)
  }

  /** 测试用：读取磁盘原始内容，断言不含明文 Key。 */
  readRawStoredForTests(): StoredProviderConfig | null {
    return readStored(this.configPath)
  }
}

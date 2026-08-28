import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  CreateProviderProfileInput,
  ProviderId,
  ProviderProfilePublic,
  ProviderProfilesPublicState,
  ProviderProtocol,
  UpdateProviderProfileInput
} from '../../shared/provider-types'
import { PROVIDER_CONFIG_SCHEMA_VERSION, PROVIDER_PRESETS } from '../../shared/provider-types'
import { PROVIDER_INPUT_LIMITS } from '../../shared/provider-limits'
import { ProviderError } from './provider-errors'
import { normalizeProviderBaseUrl, providerOriginFromBaseUrl } from './provider-url'
import { assertKeyOriginCompatible, deriveStoredKeyOrigin } from './provider-key-origin'

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

interface StoredProviderProfile {
  id: string
  name: string
  providerId: ProviderId
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  encryptedApiKey?: string
  keyLastFour?: string
  keyOrigin?: string
  createdAt: string
  updatedAt: string
}

interface StoredProviderProfilesV2 {
  schemaVersion: typeof PROVIDER_CONFIG_SCHEMA_VERSION
  activeProfileId: string | null
  profiles: StoredProviderProfile[]
}

/** 阶段 3 单配置磁盘格式（迁移源）。 */
export interface LegacyStoredProviderConfig {
  providerId: ProviderId
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  encryptedApiKey?: string
  keyLastFour?: string
  keyOrigin?: string
}

export interface ProviderConfigStoreOptions {
  configPath: string
  safeStorage: SafeStorageAdapter
}

const EMPTY_STATE: StoredProviderProfilesV2 = {
  schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION,
  activeProfileId: null,
  profiles: []
}

const ALLOWED_V2_ROOT_FIELDS = new Set([
  'schemaVersion',
  'activeProfileId',
  'profiles'
])

const ALLOWED_PROFILE_FIELDS = new Set([
  'id',
  'name',
  'providerId',
  'protocol',
  'baseUrl',
  'model',
  'encryptedApiKey',
  'keyLastFour',
  'keyOrigin',
  'createdAt',
  'updatedAt'
])

function hasUnknownFields(raw: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(raw).some((key) => !allowed.has(key))
}

function ensureParentDir(filePath: string): void {
  const dir = join(filePath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function writeStoredAtomic(filePath: string, config: StoredProviderProfilesV2): void {
  ensureParentDir(filePath)
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8')
  renameSync(tmp, filePath)
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

function validateProfileName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > PROVIDER_INPUT_LIMITS.PROFILE_NAME_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', '配置名称无效')
  }
  return trimmed
}

function validateProfileId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed || trimmed.length > PROVIDER_INPUT_LIMITS.PROFILE_ID_MAX_LENGTH) {
    throw new ProviderError('INVALID_INPUT', '配置 ID 无效')
  }
  return trimmed
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

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isValidEncryptedApiKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 8192) return false
  if (!/^[A-Za-z0-9+/]+=*$/.test(trimmed)) return false
  try {
    return Buffer.from(trimmed, 'base64').length > 0
  } catch {
    return false
  }
}

function isValidKeyLastFour(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 4
}

function stripKeyFields(): Pick<StoredProviderProfile, 'encryptedApiKey' | 'keyLastFour' | 'keyOrigin'> {
  return {
    encryptedApiKey: undefined,
    keyLastFour: undefined,
    keyOrigin: undefined
  }
}

function sanitizeKeyFields(
  baseUrl: string,
  raw: {
    encryptedApiKey?: unknown
    keyLastFour?: unknown
    keyOrigin?: unknown
  }
): Pick<StoredProviderProfile, 'encryptedApiKey' | 'keyLastFour' | 'keyOrigin'> {
  const expectedOrigin = providerOriginFromBaseUrl(baseUrl)

  if (!isValidEncryptedApiKey(raw.encryptedApiKey)) {
    if (raw.encryptedApiKey !== undefined || raw.keyLastFour !== undefined || raw.keyOrigin !== undefined) {
      return stripKeyFields()
    }
    return stripKeyFields()
  }

  if (!isValidKeyLastFour(raw.keyLastFour)) {
    return stripKeyFields()
  }

  if (typeof raw.keyOrigin === 'string' && raw.keyOrigin.trim()) {
    if (raw.keyOrigin !== expectedOrigin) {
      return stripKeyFields()
    }
    return {
      encryptedApiKey: raw.encryptedApiKey.trim(),
      keyLastFour: raw.keyLastFour,
      keyOrigin: expectedOrigin
    }
  }

  return {
    encryptedApiKey: raw.encryptedApiKey.trim(),
    keyLastFour: raw.keyLastFour,
    keyOrigin: expectedOrigin
  }
}

function isProfileKeyRunnable(profile: StoredProviderProfile): boolean {
  if (!profile.encryptedApiKey || !profile.keyLastFour || !profile.keyOrigin) return false
  if (!isValidKeyLastFour(profile.keyLastFour) || !isValidEncryptedApiKey(profile.encryptedApiKey)) {
    return false
  }
  try {
    return providerOriginFromBaseUrl(profile.baseUrl) === profile.keyOrigin
  } catch {
    return false
  }
}

function sanitizeStoredProfile(raw: unknown): StoredProviderProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const profile = raw as Record<string, unknown>
  if (typeof profile.id !== 'string' || !profile.id.trim()) return null
  if (profile.id.length > PROVIDER_INPUT_LIMITS.PROFILE_ID_MAX_LENGTH) return null
  if (typeof profile.name !== 'string' || !profile.name.trim()) return null
  if (profile.name.trim().length > PROVIDER_INPUT_LIMITS.PROFILE_NAME_MAX_LENGTH) return null
  if (profile.providerId !== 'openai' && profile.providerId !== 'deepseek' && profile.providerId !== 'custom') {
    return null
  }
  if (profile.protocol !== 'openai-chat-completions') return null
  if (!isValidIsoTimestamp(profile.createdAt) || !isValidIsoTimestamp(profile.updatedAt)) return null

  let baseUrl: string
  try {
    if (typeof profile.baseUrl !== 'string') return null
    validateRawBaseUrl(profile.baseUrl)
    baseUrl = normalizeProviderBaseUrl(profile.baseUrl)
  } catch {
    return null
  }

  let model: string
  try {
    if (typeof profile.model !== 'string') return null
    model = validateModel(profile.model)
  } catch {
    return null
  }

  const keyFields = sanitizeKeyFields(baseUrl, profile)

  return {
    id: profile.id.trim(),
    name: profile.name.trim(),
    providerId: profile.providerId,
    protocol: profile.protocol,
    baseUrl,
    model,
    ...keyFields,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  }
}

function isLegacySingleConfig(raw: Record<string, unknown>): boolean {
  return (
    raw.schemaVersion === undefined &&
    raw.profiles === undefined &&
    typeof raw.providerId === 'string' &&
    typeof raw.baseUrl === 'string' &&
    typeof raw.model === 'string'
  )
}

function legacyConfigToProfile(raw: LegacyStoredProviderConfig): StoredProviderProfile | null {
  try {
    const providerId = validateProviderId(raw.providerId)
    validateRawBaseUrl(raw.baseUrl)
    const baseUrl = normalizeProviderBaseUrl(raw.baseUrl)
    const model = validateModel(raw.model)
    const preset = PROVIDER_PRESETS.find((p) => p.id === providerId)
    const now = new Date().toISOString()
    const draft: StoredProviderProfile = {
      id: randomUUID(),
      name: `${preset?.label ?? providerId} 配置`,
      providerId,
      protocol: raw.protocol === 'openai-chat-completions' ? raw.protocol : 'openai-chat-completions',
      baseUrl,
      model,
      encryptedApiKey: typeof raw.encryptedApiKey === 'string' ? raw.encryptedApiKey : undefined,
      keyLastFour: typeof raw.keyLastFour === 'string' ? raw.keyLastFour : undefined,
      keyOrigin: typeof raw.keyOrigin === 'string' ? raw.keyOrigin : undefined,
      createdAt: now,
      updatedAt: now
    }
    return sanitizeStoredProfile(draft)
  } catch {
    return null
  }
}

function finalizeLoadedState(
  profiles: StoredProviderProfile[],
  activeProfileId: string | null
): StoredProviderProfilesV2 {
  const sorted = [...profiles].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  )
  const capped = sorted.slice(0, PROVIDER_INPUT_LIMITS.MAX_PROFILES)

  let nextActive = activeProfileId
  if (nextActive && !capped.some((p) => p.id === nextActive)) {
    nextActive = capped[0]?.id ?? null
  }
  if (!nextActive && capped.length > 0) {
    nextActive = capped[0].id
  }

  return {
    schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION,
    activeProfileId: nextActive,
    profiles: capped
  }
}

function sanitizeLoadedState(raw: unknown): { state: StoredProviderProfilesV2; dirty: boolean } {
  if (!raw || typeof raw !== 'object') return { state: { ...EMPTY_STATE }, dirty: true }

  const record = raw as Record<string, unknown>

  if (record.schemaVersion === PROVIDER_CONFIG_SCHEMA_VERSION && Array.isArray(record.profiles)) {
    const seen = new Set<string>()
    const profiles: StoredProviderProfile[] = []
    let dirty = false

    if (hasUnknownFields(record, ALLOWED_V2_ROOT_FIELDS)) {
      dirty = true
    }

    if (record.profiles.length > PROVIDER_INPUT_LIMITS.MAX_PROFILES) {
      dirty = true
    }

    for (const entry of record.profiles) {
      if (!entry || typeof entry !== 'object') {
        dirty = true
        continue
      }
      const rawEntry = entry as Record<string, unknown>
      if (hasUnknownFields(rawEntry, ALLOWED_PROFILE_FIELDS)) {
        dirty = true
      }

      const sanitized = sanitizeStoredProfile(entry)
      if (!sanitized) {
        dirty = true
        continue
      }
      if (seen.has(sanitized.id)) {
        dirty = true
        continue
      }
      seen.add(sanitized.id)
      if (profileDiffersFromSanitized(entry, sanitized)) {
        dirty = true
      }
      profiles.push(sanitized)
    }

    const activeProfileId =
      typeof record.activeProfileId === 'string' ? record.activeProfileId : null

    const state = finalizeLoadedState(profiles, activeProfileId)
    if (activeProfileId !== state.activeProfileId) {
      dirty = true
    }
    if (profiles.length !== state.profiles.length) {
      dirty = true
    }

    return { state, dirty }
  }

  if (isLegacySingleConfig(record)) {
    const profile = legacyConfigToProfile(record as unknown as LegacyStoredProviderConfig)
    if (!profile) return { state: { ...EMPTY_STATE }, dirty: true }
    return {
      state: finalizeLoadedState([profile], profile.id),
      dirty: true
    }
  }

  return { state: { ...EMPTY_STATE }, dirty: true }
}

function profileDiffersFromSanitized(entry: unknown, sanitized: StoredProviderProfile): boolean {
  if (!entry || typeof entry !== 'object') return true
  const raw = entry as Record<string, unknown>
  if (hasUnknownFields(raw, ALLOWED_PROFILE_FIELDS)) {
    return true
  }
  return (
    raw.id !== sanitized.id ||
    raw.name !== sanitized.name ||
    raw.providerId !== sanitized.providerId ||
    raw.protocol !== sanitized.protocol ||
    raw.baseUrl !== sanitized.baseUrl ||
    raw.model !== sanitized.model ||
    raw.encryptedApiKey !== sanitized.encryptedApiKey ||
    raw.keyLastFour !== sanitized.keyLastFour ||
    raw.keyOrigin !== sanitized.keyOrigin ||
    raw.createdAt !== sanitized.createdAt ||
    raw.updatedAt !== sanitized.updatedAt
  )
}

function readState(filePath: string): StoredProviderProfilesV2 {
  if (!existsSync(filePath)) return { ...EMPTY_STATE }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    const { state, dirty } = sanitizeLoadedState(parsed)
    if (dirty) {
      writeStoredAtomic(filePath, state)
    }
    return state
  } catch {
    return { ...EMPTY_STATE }
  }
}

function writeState(filePath: string, state: StoredProviderProfilesV2): void {
  writeStoredAtomic(filePath, state)
}

function toPublicProfile(profile: StoredProviderProfile, activeProfileId: string | null): ProviderProfilePublic {
  const runnable = isProfileKeyRunnable(profile)
  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.model,
    hasKey: runnable,
    keyLastFour: runnable ? profile.keyLastFour : undefined,
    isActive: profile.id === activeProfileId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  }
}

function toPublicState(state: StoredProviderProfilesV2): ProviderProfilesPublicState {
  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map((profile) => toPublicProfile(profile, state.activeProfileId))
  }
}

function resolveActiveAfterDelete(
  profiles: StoredProviderProfile[],
  deletedId: string,
  currentActive: string | null
): string | null {
  if (currentActive !== deletedId) return currentActive
  const sorted = [...profiles].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  )
  return sorted[0]?.id ?? null
}

function applyKeyUpdate(
  existing: StoredProviderProfile | undefined,
  baseUrl: string,
  newOrigin: string,
  incomingKey: string | undefined,
  safeStorage: SafeStorageAdapter
): Pick<StoredProviderProfile, 'encryptedApiKey' | 'keyLastFour' | 'keyOrigin'> {
  let encryptedApiKey = existing?.encryptedApiKey
  let keyLastFour = existing?.keyLastFour
  let keyOrigin = existing?.keyOrigin

  const trimmedKey = incomingKey?.trim()
  if (trimmedKey) {
    const validatedKey = validateApiKey(trimmedKey)
    if (!safeStorage.isEncryptionAvailable()) {
      throw new ProviderError(
        'SAFE_STORAGE_UNAVAILABLE',
        '系统安全存储不可用，无法保存 API Key。请检查 Windows 凭据保护或域策略。'
      )
    }
    const encrypted = safeStorage.encryptString(validatedKey)
    encryptedApiKey = encrypted.toString('base64')
    keyLastFour = lastFour(validatedKey)
    keyOrigin = newOrigin
  } else if (existing?.encryptedApiKey) {
    const boundOrigin = deriveStoredKeyOrigin(existing.baseUrl, existing.keyOrigin)
    assertKeyOriginCompatible(boundOrigin, newOrigin)
    keyOrigin = boundOrigin
  }

  return {
    encryptedApiKey,
    keyLastFour,
    keyOrigin: encryptedApiKey ? keyOrigin : undefined
  }
}

export class ProviderConfigStore {
  private readonly configPath: string
  private readonly safeStorage: SafeStorageAdapter

  constructor(options: ProviderConfigStoreOptions) {
    this.configPath = options.configPath
    this.safeStorage = options.safeStorage
  }

  listProfilesPublic(): ProviderProfilesPublicState {
    return toPublicState(readState(this.configPath))
  }

  getActiveProfilePublic(): ProviderProfilePublic | null {
    const state = readState(this.configPath)
    if (!state.activeProfileId) return null
    const profile = state.profiles.find((p) => p.id === state.activeProfileId)
    return profile ? toPublicProfile(profile, state.activeProfileId) : null
  }

  getProfilePublic(profileId: string): ProviderProfilePublic | null {
    const id = validateProfileId(profileId)
    const state = readState(this.configPath)
    const profile = state.profiles.find((p) => p.id === id)
    return profile ? toPublicProfile(profile, state.activeProfileId) : null
  }

  getDecryptedApiKey(profileId?: string): string | null {
    const state = readState(this.configPath)
    const id = profileId ? validateProfileId(profileId) : state.activeProfileId
    if (!id) return null
    const profile = state.profiles.find((p) => p.id === id)
    if (!profile?.encryptedApiKey || !isProfileKeyRunnable(profile)) return null
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new ProviderError('SAFE_STORAGE_UNAVAILABLE', '系统安全存储不可用，无法读取 API Key')
    }
    const encrypted = Buffer.from(profile.encryptedApiKey, 'base64')
    return this.safeStorage.decryptString(encrypted)
  }

  createProfile(input: CreateProviderProfileInput): ProviderProfilesPublicState {
    const state = readState(this.configPath)
    if (state.profiles.length >= PROVIDER_INPUT_LIMITS.MAX_PROFILES) {
      throw new ProviderError('PROFILE_LIMIT_REACHED', '已达到配置数量上限')
    }

    const providerId = validateProviderId(input.providerId)
    validateRawBaseUrl(input.baseUrl)
    const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
    const newOrigin = providerOriginFromBaseUrl(baseUrl)
    const model = validateModel(input.model)
    const name = validateProfileName(input.name)
    const preset = PROVIDER_PRESETS.find((p) => p.id === providerId)
    const protocol: ProviderProtocol = preset?.protocol ?? 'openai-chat-completions'
    const now = new Date().toISOString()

    const keyFields = applyKeyUpdate(undefined, baseUrl, newOrigin, input.apiKey, this.safeStorage)

    const profile: StoredProviderProfile = {
      id: randomUUID(),
      name,
      providerId,
      protocol,
      baseUrl,
      model,
      ...keyFields,
      createdAt: now,
      updatedAt: now
    }

    const next: StoredProviderProfilesV2 = {
      schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION,
      activeProfileId: state.activeProfileId ?? profile.id,
      profiles: [...state.profiles, profile]
    }
    if (!next.activeProfileId) next.activeProfileId = profile.id
    writeState(this.configPath, next)
    return toPublicState(next)
  }

  updateProfile(input: UpdateProviderProfileInput): ProviderProfilesPublicState {
    const profileId = validateProfileId(input.profileId)
    const state = readState(this.configPath)
    const index = state.profiles.findIndex((p) => p.id === profileId)
    if (index < 0) {
      throw new ProviderError('PROFILE_NOT_FOUND', '未找到指定的模型配置')
    }

    const existing = state.profiles[index]
    const providerId = validateProviderId(input.providerId)
    validateRawBaseUrl(input.baseUrl)
    const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
    const newOrigin = providerOriginFromBaseUrl(baseUrl)
    const model = validateModel(input.model)
    const name = validateProfileName(input.name)
    const preset = PROVIDER_PRESETS.find((p) => p.id === providerId)
    const protocol: ProviderProtocol = preset?.protocol ?? 'openai-chat-completions'

    const keyFields = applyKeyUpdate(existing, baseUrl, newOrigin, input.apiKey, this.safeStorage)

    const updated: StoredProviderProfile = {
      ...existing,
      name,
      providerId,
      protocol,
      baseUrl,
      model,
      ...keyFields,
      updatedAt: new Date().toISOString()
    }

    const profiles = [...state.profiles]
    profiles[index] = updated
    const next: StoredProviderProfilesV2 = { ...state, profiles }
    writeState(this.configPath, next)
    return toPublicState(next)
  }

  deleteProfile(profileId: string): ProviderProfilesPublicState {
    const id = validateProfileId(profileId)
    const state = readState(this.configPath)
    const nextProfiles = state.profiles.filter((p) => p.id !== id)
    if (nextProfiles.length === state.profiles.length) {
      throw new ProviderError('PROFILE_NOT_FOUND', '未找到指定的模型配置')
    }
    const next: StoredProviderProfilesV2 = {
      schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION,
      profiles: nextProfiles,
      activeProfileId: resolveActiveAfterDelete(nextProfiles, id, state.activeProfileId)
    }
    writeState(this.configPath, next)
    return toPublicState(next)
  }

  setActiveProfile(profileId: string): ProviderProfilesPublicState {
    const id = validateProfileId(profileId)
    const state = readState(this.configPath)
    if (!state.profiles.some((p) => p.id === id)) {
      throw new ProviderError('PROFILE_NOT_FOUND', '未找到指定的模型配置')
    }
    const next: StoredProviderProfilesV2 = { ...state, activeProfileId: id }
    writeState(this.configPath, next)
    return toPublicState(next)
  }

  /** 测试用：写入磁盘原始 JSON（不经过 sanitize，供篡改测试）。 */
  writeUnsanitizedJsonForTests(raw: unknown): void {
    ensureParentDir(this.configPath)
    writeFileSync(this.configPath, JSON.stringify(raw, null, 2), 'utf-8')
  }

  /** 测试用：写入磁盘原始 v2 或 legacy 内容。 */
  writeRawStoredForTests(config: StoredProviderProfilesV2 | LegacyStoredProviderConfig): void {
    if ('schemaVersion' in config && config.schemaVersion === PROVIDER_CONFIG_SCHEMA_VERSION) {
      const { state } = sanitizeLoadedState(config)
      writeState(this.configPath, state)
      return
    }
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  /** 测试用：读取磁盘原始 JSON。 */
  readRawStoredForTests(): unknown {
    if (!existsSync(this.configPath)) return null
    try {
      return JSON.parse(readFileSync(this.configPath, 'utf-8')) as unknown
    } catch {
      return null
    }
  }

  /** 测试用：读取规范化后的内部状态。 */
  readNormalizedStateForTests(): StoredProviderProfilesV2 {
    return readState(this.configPath)
  }

  /** 测试用：删除配置文件。 */
  removeConfigFileForTests(): void {
    if (existsSync(this.configPath)) rmSync(this.configPath, { force: true })
  }
}

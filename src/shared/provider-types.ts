export type ProviderId = 'openai' | 'deepseek' | 'custom'

export type ProviderProtocol = 'openai-chat-completions'

export type ProviderErrorCode =
  | 'CONFIG_MISSING'
  | 'INVALID_URL'
  | 'AUTH_FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE'
  | 'SAFE_STORAGE_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'KEY_REENTRY_REQUIRED'
  | 'IPC_UNAUTHORIZED'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_LIMIT_REACHED'

export const PROVIDER_CONFIG_SCHEMA_VERSION = '2' as const

export interface ProviderPresetInfo {
  id: ProviderId
  label: string
  protocol: ProviderProtocol
  defaultBaseUrl: string
}

/** @deprecated 使用 ProviderProfilePublic；保留供 Agent 内部快照映射。 */
export interface ProviderConfigPublic {
  providerId: ProviderId
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  hasKey: boolean
  keyLastFour?: string
}

export interface ProviderProfilePublic {
  id: string
  name: string
  providerId: ProviderId
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  hasKey: boolean
  keyLastFour?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProviderProfilesPublicState {
  activeProfileId: string | null
  profiles: ProviderProfilePublic[]
}

export interface CreateProviderProfileInput {
  name: string
  providerId: ProviderId
  baseUrl: string
  model: string
  apiKey?: string
}

export interface UpdateProviderProfileInput {
  profileId: string
  name: string
  providerId: ProviderId
  baseUrl: string
  model: string
  /** 留空表示保留现有 Key（仅当 Origin 未变）；Origin 变更须重新输入 Key。 */
  apiKey?: string
}

/** @deprecated 仅测试/内部迁移；Renderer 应使用 create/update Profile。 */
export interface SaveProviderConfigInput {
  providerId: ProviderId
  baseUrl: string
  model: string
  apiKey?: string
}

export interface ProviderTestResult {
  success: boolean
  latencyMs?: number
  providerId?: ProviderId
  model?: string
  errorCode?: ProviderErrorCode
  message?: string
  capability?: 'ok' | 'invalid_json' | 'failed'
}

export const PROVIDER_PRESETS: ProviderPresetInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.openai.com/v1'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.deepseek.com/v1'
  },
  {
    id: 'custom',
    label: 'Custom',
    protocol: 'openai-chat-completions',
    defaultBaseUrl: ''
  }
]

export const PROVIDER_PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  'openai-chat-completions': 'OpenAI-compatible Chat Completions'
}

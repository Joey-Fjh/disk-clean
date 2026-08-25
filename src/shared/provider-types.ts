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

export interface ProviderPresetInfo {
  id: ProviderId
  label: string
  protocol: ProviderProtocol
  defaultBaseUrl: string
}

export interface ProviderConfigPublic {
  providerId: ProviderId
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  hasKey: boolean
  keyLastFour?: string
}

export interface SaveProviderConfigInput {
  providerId: ProviderId
  baseUrl: string
  model: string
  /** 留空表示保留现有 Key（仅当 Origin 未变）；Origin 变更须重新输入 Key。 */
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

import type { ProviderErrorCode } from '../../shared/provider-types'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode

  constructor(code: ProviderErrorCode, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
  }
}

const USER_MESSAGES: Record<ProviderErrorCode, string> = {
  CONFIG_MISSING: '模型配置不完整，请填写 Provider、地址、模型名称和 API Key',
  INVALID_URL: 'Base URL 无效或不被允许',
  AUTH_FAILED: 'API Key 鉴权失败，请检查 Key 是否正确',
  CANCELLED: '请求已取消',
  TIMEOUT: '连接超时，请检查网络或 Base URL',
  NETWORK_ERROR: '网络请求失败，请检查网络连接',
  MODEL_NOT_FOUND: '模型不存在或当前 Key 无权访问该模型',
  INVALID_RESPONSE: '服务返回了无法解析的响应',
  RESPONSE_TOO_LARGE: '响应体过大',
  SAFE_STORAGE_UNAVAILABLE: '系统安全存储不可用，无法保存 API Key',
  INVALID_INPUT: '提交的配置无效',
  KEY_REENTRY_REQUIRED: '服务地址已变更，请重新输入 API Key 后再保存',
  IPC_UNAUTHORIZED: '未授权的 Provider 请求',
  PROFILE_NOT_FOUND: '未找到指定的模型配置',
  PROFILE_LIMIT_REACHED: '已达到配置数量上限'
}

export function providerErrorMessage(code: ProviderErrorCode): string {
  return USER_MESSAGES[code]
}

export function toProviderTestError(error: unknown): { code: ProviderErrorCode; message: string } {
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message }
  }
  return { code: 'NETWORK_ERROR', message: USER_MESSAGES.NETWORK_ERROR }
}

/** 从文本中移除 Key 与 Authorization 头信息，供日志与测试断言使用。 */
export function redactSecrets(text: string, apiKey?: string): string {
  let result = text
  if (apiKey && apiKey.length > 0) {
    result = result.split(apiKey).join('[REDACTED]')
  }
  return result
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/"authorization"\s*:\s*"[^"]*"/gi, '"authorization":"[REDACTED]"')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]')
}

export function assertNoSecretsInValue(value: unknown, apiKey?: string): void {
  const text = JSON.stringify(value)
  if (apiKey && text.includes(apiKey)) {
    throw new Error('Secret leaked into serialized value')
  }
  if (/Bearer\s+sk-/i.test(text)) {
    throw new Error('Authorization header leaked into serialized value')
  }
}

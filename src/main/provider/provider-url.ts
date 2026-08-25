import { ProviderError } from './provider-errors'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase()
  if (lower.startsWith('[') && lower.endsWith(']')) {
    return lower.slice(1, -1)
  }
  return lower
}

export function normalizeProviderBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new ProviderError('INVALID_URL', 'Base URL 不能为空')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ProviderError('INVALID_URL', 'Base URL 格式无效')
  }

  if (parsed.username || parsed.password) {
    throw new ProviderError('INVALID_URL', 'Base URL 不能包含用户名或密码')
  }

  const isLocal = LOCAL_HOSTS.has(normalizeHostname(parsed.hostname))
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new ProviderError('INVALID_URL', '仅允许 HTTPS，本地开发可使用 localhost HTTP')
  }

  const pathname = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${pathname}`
}

export function providerOriginFromBaseUrl(baseUrl: string): string {
  return new URL(normalizeProviderBaseUrl(baseUrl)).origin
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeProviderBaseUrl(baseUrl)
  return `${normalized}/chat/completions`
}

export function isAllowedProviderUrl(raw: string): boolean {
  try {
    normalizeProviderBaseUrl(raw)
    return true
  } catch {
    return false
  }
}

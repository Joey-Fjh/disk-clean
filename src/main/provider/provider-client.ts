import type { ProviderErrorCode } from '../../shared/provider-types'
import { ProviderError } from './provider-errors'
import { buildChatCompletionsUrl } from './provider-url'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  maxResponseBytes?: number
  signal?: AbortSignal
  fetchFn?: typeof fetch
}

export interface ChatCompletionResult {
  content: string
  latencyMs: number
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024

function throwAbortError(): never {
  const err = new Error('aborted')
  err.name = 'AbortError'
  throw err
}

function linkAbortSignals(
  timeoutMs: number,
  externalSignal?: AbortSignal
): {
  signal: AbortSignal
  dispose: () => void
  isTimeout: () => boolean
  isExternalCancel: () => boolean
} {
  const controller = new AbortController()
  type AbortReason = 'timeout' | 'external'
  let abortReason: AbortReason | null = null

  const timer = setTimeout(() => {
    if (abortReason) return
    abortReason = 'timeout'
    controller.abort()
  }, timeoutMs)

  const onExternalAbort = () => {
    if (abortReason) return
    abortReason = 'external'
    controller.abort()
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortReason = 'external'
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', onExternalAbort)
    }
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort)
      }
    },
    isTimeout: () => abortReason === 'timeout',
    isExternalCancel: () => abortReason === 'external'
  }
}

async function readLimitedText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    if (signal?.aborted) throwAbortError()
    const text = await response.text()
    const byteLength = new TextEncoder().encode(text).byteLength
    if (byteLength > maxBytes) {
      throw new ProviderError('RESPONSE_TOO_LARGE', '响应体过大')
    }
    return text
  }

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        throwAbortError()
      }
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new ProviderError('RESPONSE_TOO_LARGE', '响应体过大')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw error
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function mapHttpStatus(status: number, bodyText: string): ProviderError {
  const lower = bodyText.toLowerCase()
  if (status === 401 || status === 403) {
    return new ProviderError('AUTH_FAILED', 'API Key 鉴权失败')
  }
  if (status === 404 || lower.includes('model') && lower.includes('not found')) {
    return new ProviderError('MODEL_NOT_FOUND', '模型不存在或无权访问')
  }
  if (status >= 500) {
    return new ProviderError('NETWORK_ERROR', '模型服务暂时不可用')
  }
  return new ProviderError('INVALID_RESPONSE', '模型服务返回了无效响应')
}

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new ProviderError('INVALID_RESPONSE', '响应格式无效')
  }
  const choices = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new ProviderError('INVALID_RESPONSE', '响应中缺少文本内容')
  }
  return content.trim()
}

export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const fetchFn = options.fetchFn ?? fetch
  const url = buildChatCompletionsUrl(options.baseUrl)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const abortLink = linkAbortSignals(timeoutMs, options.signal)
  const started = Date.now()

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 16,
        temperature: options.temperature ?? 0
      }),
      signal: abortLink.signal
    })

    const bodyText = await readLimitedText(response, maxResponseBytes, abortLink.signal)
    if (!response.ok) {
      throw mapHttpStatus(response.status, bodyText)
    }

    let payload: unknown
    try {
      payload = JSON.parse(bodyText)
    } catch {
      throw new ProviderError('INVALID_RESPONSE', '响应不是有效 JSON')
    }

    return {
      content: extractContent(payload),
      latencyMs: Date.now() - started
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      if (abortLink.isExternalCancel()) {
        throw new ProviderError('CANCELLED', '请求已取消')
      }
      throw new ProviderError('TIMEOUT', '连接超时')
    }
    throw new ProviderError('NETWORK_ERROR', '网络请求失败')
  } finally {
    abortLink.dispose()
  }
}

export function mapProviderErrorCode(error: unknown): ProviderErrorCode {
  if (error instanceof ProviderError) return error.code
  return 'NETWORK_ERROR'
}

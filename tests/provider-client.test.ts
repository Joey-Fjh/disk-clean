import { describe, expect, it } from 'vitest'
import { chatCompletion } from '../src/main/provider/provider-client'
import { ProviderError, assertNoSecretsInValue } from '../src/main/provider/provider-errors'

const API_KEY = 'sk-test-secret-key-12345678'

function mockFetch(response: {
  ok: boolean
  status: number
  body: string
  delayMs?: number
  useReader?: boolean
}): typeof fetch {
  return (async (_url, init) => {
    if (response.delayMs && init?.signal) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, response.delayMs)
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    } else if (response.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, response.delayMs))
    }

    if (response.useReader) {
      const encoder = new TextEncoder()
      const data = encoder.encode(response.body)
      let cancelled = false
      return {
        ok: response.ok,
        status: response.status,
        body: {
          getReader: () => ({
            read: async () => {
              if (cancelled) {
                return { done: true, value: undefined }
              }
              return { done: false, value: data }
            },
            cancel: async () => {
              cancelled = true
            }
          })
        },
        text: async () => response.body
      } as unknown as Response
    }

    return {
      ok: response.ok,
      status: response.status,
      body: null,
      text: async () => response.body
    } as unknown as Response
  }) as typeof fetch
}

describe('provider client', () => {
  it('calls chat completions with minimal payload and parses content', async () => {
    let capturedBody = ''
    const fetchFn = (async (_url, init) => {
      capturedBody = String(init?.body)
      return {
        ok: true,
        status: 200,
        body: null,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'pong' } }] })
      } as unknown as Response
    }) as typeof fetch

    const result = await chatCompletion({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: API_KEY,
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 8,
      fetchFn
    })

    expect(result.content).toBe('pong')
    expect(capturedBody).toContain('"max_tokens":8')
    assertNoSecretsInValue(JSON.parse(capturedBody), API_KEY)
  })

  it('maps auth, model-not-found, and invalid response errors safely', async () => {
    await expect(
      chatCompletion({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: API_KEY,
        model: 'missing-model',
        messages: [{ role: 'user', content: 'ping' }],
        fetchFn: mockFetch({ ok: false, status: 401, body: '{"error":"invalid key"}' })
      })
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' })

    await expect(
      chatCompletion({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: API_KEY,
        model: 'missing-model',
        messages: [{ role: 'user', content: 'ping' }],
        fetchFn: mockFetch({ ok: false, status: 404, body: 'model not found' })
      })
    ).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' })

    await expect(
      chatCompletion({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: API_KEY,
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        fetchFn: mockFetch({ ok: true, status: 200, body: '{"choices":[]}' })
      })
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('times out long-running requests', async () => {
    await expect(
      chatCompletion({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: API_KEY,
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        timeoutMs: 20,
        fetchFn: mockFetch({ ok: true, status: 200, body: '{}', delayMs: 80 })
      })
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('cancels in-flight requests when external signal aborts', async () => {
    const controller = new AbortController()
    let capturedSignal: AbortSignal | undefined
    const fetchFn = (async (_url, init) => {
      capturedSignal = init?.signal ?? undefined
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 200)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
      return {
        ok: true,
        status: 200,
        body: null,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'late' } }] })
      } as unknown as Response
    }) as typeof fetch

    const promise = chatCompletion({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: API_KEY,
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      timeoutMs: 5_000,
      signal: controller.signal,
      fetchFn
    })

    setTimeout(() => controller.abort(), 20)
    await expect(promise).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('distinguishes timeout from external cancellation', async () => {
    await expect(
      chatCompletion({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: API_KEY,
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        timeoutMs: 20,
        signal: AbortSignal.abort(),
        fetchFn: mockFetch({ ok: true, status: 200, body: '{}', delayMs: 80 })
      })
    ).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('keeps timeout reason when external abort arrives after timeout fired', async () => {
    const controller = new AbortController()
    const fetchFn = (async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 200)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
      return {
        ok: true,
        status: 200,
        body: null,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'late' } }] })
      } as unknown as Response
    }) as typeof fetch

    const promise = chatCompletion({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: API_KEY,
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      timeoutMs: 20,
      signal: controller.signal,
      fetchFn
    })

    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' })
    controller.abort()
    await expect(promise).rejects.not.toMatchObject({ code: 'CANCELLED' })
  })

  it('rejects oversized response without reader using RESPONSE_TOO_LARGE', async () => {
    const huge = 'x'.repeat(300_000)
    await expect(
      chatCompletion({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: API_KEY,
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        maxResponseBytes: 1024,
        fetchFn: mockFetch({ ok: true, status: 200, body: huge })
      })
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', message: '响应体过大' })
  })

  it('rejects oversized streamed response using RESPONSE_TOO_LARGE', async () => {
    const huge = 'y'.repeat(300_000)
    const fetchFn = mockFetch({ ok: true, status: 200, body: huge, useReader: true })
    await expect(
      chatCompletion({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: API_KEY,
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        maxResponseBytes: 1024,
        fetchFn
      })
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', message: '响应体过大' })
  })
})

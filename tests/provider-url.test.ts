import { describe, expect, it } from 'vitest'
import {
  buildChatCompletionsUrl,
  isAllowedProviderUrl,
  normalizeProviderBaseUrl
} from '../src/main/provider/provider-url'
import { ProviderError } from '../src/main/provider/provider-errors'

describe('provider URL validation', () => {
  it('accepts HTTPS and trims trailing slash', () => {
    expect(normalizeProviderBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(buildChatCompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  it('accepts localhost HTTP for local development', () => {
    expect(normalizeProviderBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
    expect(normalizeProviderBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(normalizeProviderBaseUrl('http://[::1]:3000/v1')).toBe('http://[::1]:3000/v1')
  })

  it('rejects empty, invalid, credential-bearing, and non-local HTTP URLs', () => {
    expect(() => normalizeProviderBaseUrl('')).toThrow(ProviderError)
    expect(() => normalizeProviderBaseUrl('not-a-url')).toThrow(ProviderError)
    expect(() => normalizeProviderBaseUrl('https://user:pass@api.example.com/v1')).toThrow(ProviderError)
    expect(() => normalizeProviderBaseUrl('http://api.example.com/v1')).toThrow(ProviderError)
    expect(isAllowedProviderUrl('http://evil.test/v1')).toBe(false)
  })
})

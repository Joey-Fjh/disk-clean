import { describe, expect, it } from 'vitest'
import {
  assertNoSecretsInValue,
  ProviderError,
  redactSecrets,
  toProviderTestError
} from '../src/main/provider/provider-errors'

describe('provider errors and redaction', () => {
  const apiKey = 'sk-test-secret-key-12345678'

  it('maps ProviderError to safe test errors', () => {
    const mapped = toProviderTestError(new ProviderError('AUTH_FAILED', 'API Key 鉴权失败'))
    expect(mapped.code).toBe('AUTH_FAILED')
    expect(mapped.message).not.toContain(apiKey)
  })

  it('redacts bearer tokens and api keys from text', () => {
    const text = `Authorization: Bearer ${apiKey} and sk-abcdefgh12345678`
    const redacted = redactSecrets(text, apiKey)
    expect(redacted).not.toContain(apiKey)
    expect(redacted).not.toContain('sk-abcdefgh12345678')
    expect(redacted).toContain('[REDACTED]')
  })

  it('assertNoSecretsInValue rejects leaked secrets', () => {
    expect(() => assertNoSecretsInValue({ key: apiKey }, apiKey)).toThrow(/Secret leaked/)
    expect(() => assertNoSecretsInValue({ auth: 'Bearer sk-abcdefgh12345678' })).toThrow(
      /Authorization header leaked/
    )
    expect(() => assertNoSecretsInValue({ hasKey: true, keyLastFour: '5678' }, apiKey)).not.toThrow()
  })
})

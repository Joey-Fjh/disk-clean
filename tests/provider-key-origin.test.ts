import { describe, expect, it } from 'vitest'
import {
  assertKeyOriginCompatible,
  deriveStoredKeyOrigin
} from '../src/main/provider/provider-key-origin'
import { ProviderError } from '../src/main/provider/provider-errors'

describe('provider key origin helpers', () => {
  it('uses keyOrigin when present', () => {
    expect(deriveStoredKeyOrigin('https://api.openai.com/v1', 'https://api.openai.com')).toBe(
      'https://api.openai.com'
    )
  })

  it('derives origin from legacy baseUrl when keyOrigin missing', () => {
    expect(deriveStoredKeyOrigin('https://api.openai.com/v1/')).toBe('https://api.openai.com')
  })

  it('rejects legacy baseUrl that cannot be parsed', () => {
    expect(() => deriveStoredKeyOrigin('not-a-valid-url')).toThrowError(
      expect.objectContaining({ code: 'KEY_REENTRY_REQUIRED' })
    )
  })

  it('assertKeyOriginCompatible throws on mismatch', () => {
    expect(() =>
      assertKeyOriginCompatible('https://api.openai.com', 'https://api.deepseek.com')
    ).toThrowError(expect.objectContaining({ code: 'KEY_REENTRY_REQUIRED' }))
  })
})

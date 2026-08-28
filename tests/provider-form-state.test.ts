import { describe, expect, it } from 'vitest'
import {
  canRunProviderTests,
  canRunProviderTestsAfterSave,
  isProviderFormDirty,
  providerFormValuesFromSaved,
  requiresKeyReentry
} from '../src/renderer/provider-form-state'
import type { ProviderProfilePublic } from '../src/shared/provider-types'

const saved: ProviderProfilePublic = {
  id: 'profile-1',
  name: 'OpenAI',
  providerId: 'openai',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  hasKey: true,
  keyLastFour: '1234',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('provider form state', () => {
  it('detects dirty form when base URL changes', () => {
    expect(
      isProviderFormDirty(
        {
          name: 'OpenAI',
          providerId: 'openai',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'gpt-4o-mini',
          apiKey: ''
        },
        saved
      )
    ).toBe(true)
  })

  it('treats same-origin path change as dirty and blocks tests', () => {
    const sameOriginPath = {
      name: 'OpenAI',
      providerId: 'openai' as const,
      baseUrl: 'https://api.openai.com/v2',
      model: 'gpt-4o-mini',
      apiKey: ''
    }
    expect(isProviderFormDirty(sameOriginPath, saved)).toBe(true)
    expect(canRunProviderTests(sameOriginPath, saved, false)).toBe(false)
  })

  it('allows tests only when form matches saved config', () => {
    const matching = {
      name: 'OpenAI',
      providerId: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: ''
    }
    expect(canRunProviderTests(matching, saved, false)).toBe(true)
    expect(canRunProviderTests({ ...matching, apiKey: 'new-key' }, saved, false)).toBe(false)
    expect(canRunProviderTests(matching, saved, true)).toBe(false)
  })

  it('syncs form from normalized saved config after save', () => {
    const normalized: ProviderProfilePublic = {
      ...saved,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o'
    }
    const dirtyInput = {
      name: 'OpenAI',
      providerId: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1/  ',
      model: ' gpt-4o ',
      apiKey: ''
    }
    expect(isProviderFormDirty(dirtyInput, normalized)).toBe(true)

    const synced = providerFormValuesFromSaved(normalized)
    expect(synced.baseUrl).toBe('https://api.openai.com/v1')
    expect(synced.model).toBe('gpt-4o')
    expect(synced.apiKey).toBe('')
    expect(isProviderFormDirty(synced, normalized)).toBe(false)
    expect(canRunProviderTestsAfterSave(normalized)).toBe(true)
  })

  it('flags key reentry when origin changes without new key', () => {
    const form = {
      name: 'OpenAI',
      providerId: 'openai' as const,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'gpt-4o-mini',
      apiKey: ''
    }
    expect(requiresKeyReentry(form, saved)).toBe(true)
    expect(canRunProviderTests(form, saved, false)).toBe(false)
  })
})

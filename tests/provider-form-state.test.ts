import { describe, expect, it } from 'vitest'
import {
  canRunProviderTests,
  canRunProviderTestsAfterSave,
  isProviderFormDirty,
  providerFormValuesFromSaved
} from '../src/renderer/provider-form-state'
import type { ProviderConfigPublic } from '../src/shared/provider-types'

const saved: ProviderConfigPublic = {
  providerId: 'openai',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  hasKey: true,
  keyLastFour: '1234'
}

describe('provider form state', () => {
  it('detects dirty form when base URL changes', () => {
    expect(
      isProviderFormDirty(
        { providerId: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'gpt-4o-mini', apiKey: '' },
        saved
      )
    ).toBe(true)
  })

  it('treats same-origin path change as dirty but allows saved-key tests only when saved', () => {
    const sameOriginPath = {
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v2',
      model: 'gpt-4o-mini',
      apiKey: ''
    }
    expect(isProviderFormDirty(sameOriginPath, saved)).toBe(true)
    expect(canRunProviderTests(sameOriginPath, saved, false)).toBe(false)
  })

  it('allows tests only when form matches saved config', () => {
    const matching = {
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
    const normalized: ProviderConfigPublic = {
      ...saved,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o'
    }
    const dirtyInput = {
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

  it('disables tests when form has unsaved changes (test tab behavior)', () => {
    const dirtyInput = {
      providerId: 'openai' as const,
      baseUrl: 'https://api.openai.com/v2',
      model: 'gpt-4o-mini',
      apiKey: ''
    }
    expect(canRunProviderTests(dirtyInput, saved, false)).toBe(false)
  })
})

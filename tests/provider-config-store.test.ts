import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProviderConfigStore,
  type SafeStorageAdapter
} from '../src/main/provider/provider-config-store'
import { ProviderError } from '../src/main/provider/provider-errors'
import { assertNoSecretsInValue } from '../src/main/provider/provider-errors'
import { PROVIDER_INPUT_LIMITS } from '../src/shared/provider-limits'

const API_KEY = 'sk-test-secret-key-12345678'

function mockSafeStorage(available = true): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(`enc:${plainText}`, 'utf-8'),
    decryptString: (encrypted) => encrypted.toString('utf-8').replace(/^enc:/, '')
  }
}

function createStore(available = true): { store: ProviderConfigStore; path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-provider-'))
  const path = join(dir, 'provider-config.json')
  return { store: new ProviderConfigStore({ configPath: path, safeStorage: mockSafeStorage(available) }), path, dir }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('ProviderConfigStore', () => {
  it('encrypts API key on disk without plaintext and binds key origin', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    const saved = store.saveConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    expect(saved.hasKey).toBe(true)
    expect(saved.keyLastFour).toBe('5678')
    assertNoSecretsInValue(saved, API_KEY)

    const raw = store.readRawStoredForTests()
    expect(raw?.encryptedApiKey).toBeTruthy()
    expect(raw?.keyOrigin).toBe('https://api.openai.com')
    expect(JSON.stringify(raw)).not.toContain(API_KEY)
    expect(store.getDecryptedApiKey()).toBe(API_KEY)
  })

  it('refuses to save key when safeStorage is unavailable', () => {
    const { store, dir } = createStore(false)
    tempDirs.push(dir)

    expect(() =>
      store.saveConfig({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: API_KEY
      })
    ).toThrow(ProviderError)
  })

  it('keeps existing key when origin unchanged and apiKey is empty', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.saveConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    const updated = store.saveConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v2',
      model: 'gpt-4o'
    })

    expect(updated.baseUrl).toBe('https://api.openai.com/v2')
    expect(updated.hasKey).toBe(true)
    expect(updated.keyLastFour).toBe('5678')
    expect(store.getDecryptedApiKey()).toBe(API_KEY)
    expect(store.readRawStoredForTests()?.keyOrigin).toBe('https://api.openai.com')
  })

  it('rejects OpenAI to DeepSeek origin change without new key', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.saveConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    expect(() =>
      store.saveConfig({
        providerId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat'
      })
    ).toThrowError(
      expect.objectContaining({ code: 'KEY_REENTRY_REQUIRED' })
    )

    expect(store.getDecryptedApiKey()).toBe(API_KEY)
    expect(store.readRawStoredForTests()?.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('rejects custom domain change without new key', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.saveConfig({
      providerId: 'custom',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    expect(() =>
      store.saveConfig({
        providerId: 'custom',
        baseUrl: 'https://other.example.com/v1',
        model: 'gpt-4o-mini'
      })
    ).toThrowError(expect.objectContaining({ code: 'KEY_REENTRY_REQUIRED' }))
  })

  it('allows origin change when new key is provided', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.saveConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    const updated = store.saveConfig({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-deepseek-new-key-0001'
    })

    expect(updated.hasKey).toBe(true)
    expect(updated.keyLastFour).toBe('0001')
    expect(store.getDecryptedApiKey()).toBe('sk-deepseek-new-key-0001')
    expect(store.readRawStoredForTests()?.keyOrigin).toBe('https://api.deepseek.com')
  })

  it('replaces and deletes API key correctly', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.saveConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    const replaced = store.saveConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-replaced-key-9999'
    })
    expect(replaced.keyLastFour).toBe('9999')
    expect(store.getDecryptedApiKey()).toBe('sk-replaced-key-9999')

    const afterDelete = store.deleteApiKey()
    expect(afterDelete?.hasKey).toBe(false)
    expect(afterDelete?.keyLastFour).toBeUndefined()
    expect(store.getDecryptedApiKey()).toBeNull()
    expect(store.readRawStoredForTests()?.encryptedApiKey).toBeUndefined()
    expect(store.readRawStoredForTests()?.keyOrigin).toBeUndefined()
  })

  it('public config never exposes full key', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.saveConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    const pub = store.getPublicConfig()
    assertNoSecretsInValue(pub, API_KEY)
    expect(pub?.hasKey).toBe(true)
    expect(pub?.keyLastFour).toBe('5678')
  })

  it('migrates legacy config without keyOrigin on same origin', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.writeRawStoredForTests({
      providerId: 'openai',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      encryptedApiKey: Buffer.from(`enc:${API_KEY}`, 'utf-8').toString('base64'),
      keyLastFour: '5678'
    })

    const updated = store.saveConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1/',
      model: 'gpt-4o'
    })

    expect(updated.hasKey).toBe(true)
    expect(updated.baseUrl).toBe('https://api.openai.com/v1')
    expect(store.getDecryptedApiKey()).toBe(API_KEY)
    expect(store.readRawStoredForTests()?.keyOrigin).toBe('https://api.openai.com')
  })

  it('rejects legacy config cross-origin migration without new key', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.writeRawStoredForTests({
      providerId: 'openai',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      encryptedApiKey: Buffer.from(`enc:${API_KEY}`, 'utf-8').toString('base64'),
      keyLastFour: '5678'
    })

    expect(() =>
      store.saveConfig({
        providerId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat'
      })
    ).toThrowError(expect.objectContaining({ code: 'KEY_REENTRY_REQUIRED' }))

    expect(store.readRawStoredForTests()?.keyOrigin).toBeUndefined()
    expect(store.getDecryptedApiKey()).toBe(API_KEY)
  })

  it('rejects legacy config with unparseable baseUrl', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.writeRawStoredForTests({
      providerId: 'custom',
      protocol: 'openai-chat-completions',
      baseUrl: 'not-a-valid-url',
      model: 'gpt-4o-mini',
      encryptedApiKey: Buffer.from(`enc:${API_KEY}`, 'utf-8').toString('base64'),
      keyLastFour: '5678'
    })

    expect(() =>
      store.saveConfig({
        providerId: 'custom',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini'
      })
    ).toThrowError(expect.objectContaining({ code: 'KEY_REENTRY_REQUIRED' }))
  })

  it('rejects overly long base URL, model, and api key', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    expect(() =>
      store.saveConfig({
        providerId: 'openai',
        baseUrl: `https://api.openai.com/${'a'.repeat(PROVIDER_INPUT_LIMITS.BASE_URL_MAX_LENGTH)}`,
        model: 'gpt-4o-mini',
        apiKey: API_KEY
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))

    expect(() =>
      store.saveConfig({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'x'.repeat(PROVIDER_INPUT_LIMITS.MODEL_MAX_LENGTH + 1),
        apiKey: API_KEY
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))

    expect(() =>
      store.saveConfig({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: 'k'.repeat(PROVIDER_INPUT_LIMITS.API_KEY_MAX_LENGTH + 1)
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })
})

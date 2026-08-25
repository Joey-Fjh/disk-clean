import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderConfigStore, type SafeStorageAdapter } from '../src/main/provider/provider-config-store'
import { assertNoSecretsInValue } from '../src/main/provider/provider-errors'
import {
  deleteProviderApiKey,
  saveProviderConfig,
  setProviderStoreForTests,
  testProviderCapability,
  testProviderConnection
} from '../src/main/provider/provider-service'

const API_KEY = 'sk-test-secret-key-12345678'

function mockSafeStorage(): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(`enc:${plainText}`, 'utf-8'),
    decryptString: (encrypted) => encrypted.toString('utf-8').replace(/^enc:/, '')
  }
}

const tempDirs: string[] = []

afterEach(() => {
  setProviderStoreForTests(null)
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function installStore(): ProviderConfigStore {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-provider-service-'))
  tempDirs.push(dir)
  const store = new ProviderConfigStore({
    configPath: join(dir, 'provider-config.json'),
    safeStorage: mockSafeStorage()
  })
  setProviderStoreForTests(store)
  return store
}

describe('provider service', () => {
  it('returns CONFIG_MISSING when testing without saved key', async () => {
    installStore()
    const result = await testProviderConnection()
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('CONFIG_MISSING')
    assertNoSecretsInValue(result, API_KEY)
  })

  it('runs connection test with fixed ping message and token limit', async () => {
    installStore()
    saveProviderConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    let body = ''
    const fetchFn = (async (_url, init) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    }) as typeof fetch

    const result = await testProviderConnection(fetchFn)
    expect(result.success).toBe(true)
    expect(body).toContain('ping')
    expect(body).toContain('"max_tokens":8')
    assertNoSecretsInValue(JSON.parse(body), API_KEY)
    assertNoSecretsInValue(result, API_KEY)
  })

  it('detects valid and invalid capability JSON responses', async () => {
    installStore()
    saveProviderConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    const okFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"status":"ok","source":"disk-clean"}' } }]
        }),
        { status: 200 }
      )) as typeof fetch

    const ok = await testProviderCapability(okFetch)
    expect(ok.success).toBe(true)
    expect(ok.capability).toBe('ok')

    const badFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), {
        status: 200
      })) as typeof fetch

    const bad = await testProviderCapability(badFetch)
    expect(bad.success).toBe(false)
    expect(bad.capability).toBe('invalid_json')
  })

  it('deleteProviderApiKey clears key metadata', () => {
    installStore()
    saveProviderConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })

    const deleted = deleteProviderApiKey()
    expect(deleted?.hasKey).toBe(false)
    expect(deleted?.keyLastFour).toBeUndefined()
  })
})

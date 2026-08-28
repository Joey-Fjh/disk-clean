import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderConfigStore, type SafeStorageAdapter } from '../src/main/provider/provider-config-store'
import { assertNoSecretsInValue } from '../src/main/provider/provider-errors'
import {
  createProviderProfile,
  deleteProviderProfile,
  listProviderProfiles,
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
  it('returns CONFIG_MISSING when testing profile without saved key', async () => {
    installStore()
    const created = createProviderProfile({
      name: 'Empty',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    })
    const result = await testProviderConnection(created.profiles[0].id)
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
    const profileId = listProviderProfiles().activeProfileId!

    let body = ''
    const fetchFn = (async (_url, init) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    }) as typeof fetch

    const result = await testProviderConnection(profileId, fetchFn)
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
    const profileId = listProviderProfiles().activeProfileId!

    const okFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"status":"ok","source":"disk-clean"}' } }]
        }),
        { status: 200 }
      )) as typeof fetch

    const ok = await testProviderCapability(profileId, okFetch)
    expect(ok.success).toBe(true)
    expect(ok.capability).toBe('ok')

    const badFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), {
        status: 200
      })) as typeof fetch

    const bad = await testProviderCapability(profileId, badFetch)
    expect(bad.success).toBe(false)
    expect(bad.capability).toBe('invalid_json')
  })

  it('deleteProviderProfile removes entire profile including key', () => {
    installStore()
    saveProviderConfig({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: API_KEY
    })
    const profileId = listProviderProfiles().activeProfileId!
    const deleted = deleteProviderProfile(profileId)
    expect(deleted.profiles).toHaveLength(0)
    expect(deleted.activeProfileId).toBeNull()
  })
})

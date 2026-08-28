import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProviderConfigStore,
  type LegacyStoredProviderConfig,
  type SafeStorageAdapter
} from '../src/main/provider/provider-config-store'
import { ProviderError } from '../src/main/provider/provider-errors'
import { assertNoSecretsInValue } from '../src/main/provider/provider-errors'
import { PROVIDER_CONFIG_SCHEMA_VERSION } from '../src/shared/provider-types'
import { PROVIDER_INPUT_LIMITS } from '../src/shared/provider-limits'

const OPENAI_KEY = 'sk-openai-secret-key-12345678'
const DEEPSEEK_KEY = 'sk-deepseek-secret-key-abcdef01'

function mockSafeStorage(available = true): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(`enc:${plainText}`, 'utf-8'),
    decryptString: (encrypted) => encrypted.toString('utf-8').replace(/^enc:/, '')
  }
}

function createStore(available = true): { store: ProviderConfigStore; path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-provider-profiles-'))
  const path = join(dir, 'provider-config.json')
  return { store: new ProviderConfigStore({ configPath: path, safeStorage: mockSafeStorage(available) }), path, dir }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('ProviderConfigStore multi-profile', () => {
  it('creates profiles with independent encrypted keys', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    const first = store.createProfile({
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: OPENAI_KEY
    })
    const openAiId = first.activeProfileId!
    expect(first.profiles).toHaveLength(1)
    expect(first.profiles[0].hasKey).toBe(true)
    expect(first.profiles[0].keyLastFour).toBe('5678')

    const second = store.createProfile({
      name: 'DeepSeek',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: DEEPSEEK_KEY
    })
    expect(second.profiles).toHaveLength(2)
    const deepSeek = second.profiles.find((p) => p.name === 'DeepSeek')
    expect(deepSeek?.hasKey).toBe(true)
    expect(deepSeek?.keyLastFour).toBe('ef01')
    expect(store.getDecryptedApiKey(openAiId)).toBe(OPENAI_KEY)
    expect(store.getDecryptedApiKey(deepSeek!.id)).toBe(DEEPSEEK_KEY)

    const raw = JSON.stringify(store.readRawStoredForTests())
    expect(raw).not.toContain(OPENAI_KEY)
    expect(raw).not.toContain(DEEPSEEK_KEY)
  })

  it('does not inherit key when creating a second profile', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.createProfile({
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: OPENAI_KEY
    })

    const created = store.createProfile({
      name: 'DeepSeek',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    })
    const deepSeek = created.profiles.find((p) => p.name === 'DeepSeek')
    expect(deepSeek?.hasKey).toBe(false)
    expect(store.getDecryptedApiKey(deepSeek!.id)).toBeNull()
  })

  it('keeps key on same origin path change and rejects cross-origin without new key', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    const created = store.createProfile({
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: OPENAI_KEY
    })
    const profileId = created.profiles[0].id

    const updated = store.updateProfile({
      profileId,
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v2',
      model: 'gpt-4o'
    })
    expect(updated.profiles[0].hasKey).toBe(true)
    expect(store.getDecryptedApiKey(profileId)).toBe(OPENAI_KEY)

    expect(() =>
      store.updateProfile({
        profileId,
        name: 'DeepSeek',
        providerId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat'
      })
    ).toThrowError(expect.objectContaining({ code: 'KEY_REENTRY_REQUIRED' }))
  })

  it('switches active profile and deletes active with deterministic fallback', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    const first = store.createProfile({
      name: 'A',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: OPENAI_KEY
    })
    const second = store.createProfile({
      name: 'B',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: DEEPSEEK_KEY
    })
    const profileA = first.profiles[0].id
    const profileB = second.profiles.find((p) => p.name === 'B')!.id

    const switched = store.setActiveProfile(profileB)
    expect(switched.activeProfileId).toBe(profileB)
    expect(switched.profiles.find((p) => p.id === profileB)?.isActive).toBe(true)

    const afterDelete = store.deleteProfile(profileB)
    expect(afterDelete.profiles).toHaveLength(1)
    expect(afterDelete.activeProfileId).toBe(profileA)
  })

  it('enforces profile name and count limits', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    expect(() =>
      store.createProfile({
        name: '   ',
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini'
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))

    for (let i = 0; i < PROVIDER_INPUT_LIMITS.MAX_PROFILES; i++) {
      store.createProfile({
        name: `Profile ${i}`,
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: `model-${i}`
      })
    }

    expect(() =>
      store.createProfile({
        name: 'Overflow',
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini'
      })
    ).toThrowError(expect.objectContaining({ code: 'PROFILE_LIMIT_REACHED' }))
  })

  it('migrates legacy single config with key and is idempotent', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    const legacy: LegacyStoredProviderConfig = {
      providerId: 'openai',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      encryptedApiKey: Buffer.from(`enc:${OPENAI_KEY}`, 'utf-8').toString('base64'),
      keyLastFour: '5678',
      keyOrigin: 'https://api.openai.com'
    }
    store.writeRawStoredForTests(legacy)

    const firstRead = store.listProfilesPublic()
    expect(firstRead.profiles).toHaveLength(1)
    expect(firstRead.activeProfileId).toBe(firstRead.profiles[0].id)
    expect(firstRead.profiles[0].hasKey).toBe(true)
    expect(store.getDecryptedApiKey(firstRead.profiles[0].id)).toBe(OPENAI_KEY)

    const raw = store.readRawStoredForTests() as { schemaVersion?: string; profiles?: unknown[] }
    expect(raw.schemaVersion).toBe(PROVIDER_CONFIG_SCHEMA_VERSION)
    expect(raw.profiles).toHaveLength(1)

    const secondRead = store.listProfilesPublic()
    expect(secondRead.profiles).toHaveLength(1)
    expect(secondRead.profiles[0].id).toBe(firstRead.profiles[0].id)
  })

  it('migrates legacy config without key', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.writeRawStoredForTests({
      providerId: 'deepseek',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    })

    const state = store.listProfilesPublic()
    expect(state.profiles).toHaveLength(1)
    expect(state.profiles[0].hasKey).toBe(false)
    expect(state.activeProfileId).toBe(state.profiles[0].id)
  })

  it('migrates legacy config without keyOrigin and keeps key on same-origin update', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.writeRawStoredForTests({
      providerId: 'openai',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      encryptedApiKey: Buffer.from(`enc:${OPENAI_KEY}`, 'utf-8').toString('base64'),
      keyLastFour: '5678'
    })

    const state = store.listProfilesPublic()
    const profileId = state.profiles[0].id
    const updated = store.updateProfile({
      profileId,
      name: state.profiles[0].name,
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1/',
      model: 'gpt-4o'
    })
    expect(updated.profiles[0].hasKey).toBe(true)
    expect(store.getDecryptedApiKey(profileId)).toBe(OPENAI_KEY)
  })

  it('rejects invalid legacy cross-origin migration without new key', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.writeRawStoredForTests({
      providerId: 'openai',
      protocol: 'openai-chat-completions',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      encryptedApiKey: Buffer.from(`enc:${OPENAI_KEY}`, 'utf-8').toString('base64'),
      keyLastFour: '5678'
    })

    const profileId = store.listProfilesPublic().profiles[0].id
    expect(() =>
      store.updateProfile({
        profileId,
        name: 'DeepSeek',
        providerId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat'
      })
    ).toThrowError(expect.objectContaining({ code: 'KEY_REENTRY_REQUIRED' }))
  })

  it('ignores corrupted JSON and duplicate profile IDs on load', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.writeUnsanitizedJsonForTests({
      schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION,
      activeProfileId: 'dup-id',
      profiles: [
        {
          id: 'dup-id',
          name: 'First',
          providerId: 'openai',
          protocol: 'openai-chat-completions',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'dup-id',
          name: 'Duplicate',
          providerId: 'deepseek',
          protocol: 'openai-chat-completions',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z'
        },
        {
          id: 'bad',
          name: '',
          providerId: 'openai',
          protocol: 'openai-chat-completions',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-03T00:00:00.000Z'
        }
      ]
    })

    const state = store.listProfilesPublic()
    expect(state.profiles).toHaveLength(1)
    expect(state.profiles[0].name).toBe('First')
    expect(state.activeProfileId).toBe('dup-id')

    const persisted = store.readNormalizedStateForTests()
    expect(persisted.profiles).toHaveLength(1)
  })

  it('strips tampered key binding and blocks network use for mismatched origin', async () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    const created = store.createProfile({
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: OPENAI_KEY
    })
    const profileId = created.profiles[0].id
    const normalized = store.readNormalizedStateForTests()
    const stored = normalized.profiles[0]

    store.writeUnsanitizedJsonForTests({
      schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION,
      activeProfileId: profileId,
      profiles: [
        {
          ...stored,
          baseUrl: 'https://evil.example.com/v1',
          keyOrigin: 'https://api.openai.com'
        }
      ]
    })

    const pub = store.listProfilesPublic()
    expect(pub.profiles[0].hasKey).toBe(false)
    expect(pub.profiles[0].keyLastFour).toBeUndefined()
    assertNoSecretsInValue(pub, OPENAI_KEY)

    const { setProviderStoreForTests, testProviderConnection } = await import(
      '../src/main/provider/provider-service'
    )
    setProviderStoreForTests(store)

    let fetchCalled = false
    const result = await testProviderConnection(profileId, (async () => {
      fetchCalled = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch)

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('CONFIG_MISSING')
    expect(fetchCalled).toBe(false)
    setProviderStoreForTests(null)
  })

  it('rejects credential-bearing base URLs and oversized keyLastFour on load', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    store.writeUnsanitizedJsonForTests({
      schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION,
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Bad URL',
          providerId: 'custom',
          protocol: 'openai-chat-completions',
          baseUrl: 'https://user:pass@api.openai.com/v1',
          model: 'gpt-4o-mini',
          encryptedApiKey: Buffer.from(`enc:${OPENAI_KEY}`, 'utf-8').toString('base64'),
          keyLastFour: OPENAI_KEY,
          keyOrigin: 'https://api.openai.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })

    const state = store.listProfilesPublic()
    expect(state.profiles).toHaveLength(0)
    expect(state.activeProfileId).toBeNull()
  })

  it('caps profiles to MAX_PROFILES on load and persists sanitized state', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    const profiles = Array.from({ length: PROVIDER_INPUT_LIMITS.MAX_PROFILES + 3 }, (_, index) => ({
      id: `profile-${index}`,
      name: `Profile ${index}`,
      providerId: 'openai' as const,
      protocol: 'openai-chat-completions' as const,
      baseUrl: 'https://api.openai.com/v1',
      model: `model-${index}`,
      createdAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      updatedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
    }))

    store.writeUnsanitizedJsonForTests({
      schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION,
      activeProfileId: 'profile-25',
      profiles
    })

    const state = store.listProfilesPublic()
    expect(state.profiles).toHaveLength(PROVIDER_INPUT_LIMITS.MAX_PROFILES)
    expect(state.activeProfileId).toBe('profile-0')
    expect(store.readNormalizedStateForTests().profiles).toHaveLength(PROVIDER_INPUT_LIMITS.MAX_PROFILES)
  })

  it('persists sanitized v2 when profiles contain unknown credential fields', () => {
    const { store, path, dir } = createStore()
    tempDirs.push(dir)

    const created = store.createProfile({
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: OPENAI_KEY
    })
    const profileId = created.profiles[0].id
    const normalized = store.readNormalizedStateForTests()
    const stored = normalized.profiles[0]

    store.writeUnsanitizedJsonForTests({
      schemaVersion: PROVIDER_CONFIG_SCHEMA_VERSION,
      activeProfileId: profileId,
      leakedMeta: 'should-not-persist',
      profiles: [
        {
          ...stored,
          apiKey: OPENAI_KEY,
          authorization: `Bearer ${OPENAI_KEY}`
        }
      ]
    })

    store.listProfilesPublic()

    const disk = readFileSync(path, 'utf-8')
    expect(disk).not.toContain(OPENAI_KEY)
    expect(disk).not.toContain('apiKey')
    expect(disk).not.toContain('authorization')
    expect(disk).not.toContain('leakedMeta')
    expect(store.readNormalizedStateForTests().profiles[0].encryptedApiKey).toBeTruthy()
    expect(store.listProfilesPublic().profiles[0].hasKey).toBe(true)
  })

  it('public profiles never expose plaintext key', () => {
    const { store, dir } = createStore()
    tempDirs.push(dir)

    const created = store.createProfile({
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: OPENAI_KEY
    })
    assertNoSecretsInValue(created, OPENAI_KEY)
  })

  it('refuses to save key when safeStorage is unavailable', () => {
    const { store, dir } = createStore(false)
    tempDirs.push(dir)

    expect(() =>
      store.createProfile({
        name: 'OpenAI',
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: OPENAI_KEY
      })
    ).toThrow(ProviderError)
  })
})

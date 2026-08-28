import type { IpcMainInvokeEvent } from 'electron'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderConfigStore } from '../src/main/provider/provider-config-store'
import {
  handleProviderCreateProfile,
  handleProviderDeleteProfile,
  handleProviderListProfiles,
  handleProviderSetActiveProfile,
  handleProviderTestConnection,
  handleProviderUpdateProfile
} from '../src/main/provider/provider-ipc'
import { setProviderStoreForTests } from '../src/main/provider/provider-service'
import { setTrustedSenderCheckerForTests } from '../src/main/window-security'

function mockEvent(senderId: number): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as IpcMainInvokeEvent
}

function mockSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(`enc:${plainText}`, 'utf-8'),
    decryptString: (encrypted: Buffer) => encrypted.toString('utf-8').replace(/^enc:/, '')
  }
}

const tempDirs: string[] = []

function installTempStore(): ProviderConfigStore {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-provider-ipc-'))
  tempDirs.push(dir)
  const store = new ProviderConfigStore({
    configPath: join(dir, 'provider-config.json'),
    safeStorage: mockSafeStorage()
  })
  setProviderStoreForTests(store)
  return store
}

afterEach(() => {
  setTrustedSenderCheckerForTests(null)
  setProviderStoreForTests(null)
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('provider IPC security and error contract', () => {
  it('rejects unauthorized sender with structured IPC_UNAUTHORIZED', () => {
    setTrustedSenderCheckerForTests((sender) => sender.id === 100)

    const result = handleProviderListProfiles(mockEvent(1))
    expect(result).toEqual({
      ok: false,
      code: 'IPC_UNAUTHORIZED',
      message: '未授权的 Provider 请求'
    })
  })

  it('returns structured KEY_REENTRY_REQUIRED for origin change without new key', () => {
    installTempStore()
    setTrustedSenderCheckerForTests((sender) => sender.id === 1)

    const created = handleProviderCreateProfile(mockEvent(1), {
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-contract-test-key-1234'
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const profileId = created.value.profiles[0].id

    const saveDeepSeek = handleProviderUpdateProfile(mockEvent(1), {
      profileId,
      name: 'DeepSeek',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    })
    expect(saveDeepSeek).toEqual({
      ok: false,
      code: 'KEY_REENTRY_REQUIRED',
      message: '服务地址已变更，请重新输入 API Key 后再保存'
    })
  })

  it('returns structured INVALID_INPUT for oversized IPC payload', () => {
    setTrustedSenderCheckerForTests((sender) => sender.id === 1)

    const result = handleProviderCreateProfile(mockEvent(1), {
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'k'.repeat(600)
    })
    expect(result).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
      message: 'API Key 无效'
    })
  })

  it('allows trusted sender for provider test IPC with profileId only', async () => {
    installTempStore()
    setTrustedSenderCheckerForTests((sender) => sender.id === 1)

    const result = await handleProviderTestConnection(mockEvent(1), { profileId: 'missing-profile' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.success).toBe(false)
      expect(result.value.errorCode).toBe('PROFILE_NOT_FOUND')
    }
  })

  it('rejects unauthorized sender for delete profile', () => {
    setTrustedSenderCheckerForTests((sender) => sender.id === 42)

    const result = handleProviderDeleteProfile(mockEvent(7), { profileId: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('IPC_UNAUTHORIZED')
    }
  })

  it('rejects setActive for unknown profile', () => {
    installTempStore()
    setTrustedSenderCheckerForTests((sender) => sender.id === 1)

    const result = handleProviderSetActiveProfile(mockEvent(1), { profileId: 'missing' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('PROFILE_NOT_FOUND')
    }
  })
})

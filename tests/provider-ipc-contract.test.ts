import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('provider IPC contract', () => {
  it('preload exposes only provider-safe methods', () => {
    const preload = readFileSync(join(process.cwd(), 'src/preload/index.ts'), 'utf-8')
    const dts = readFileSync(join(process.cwd(), 'src/preload/index.d.ts'), 'utf-8')

    expect(preload).toContain("contextBridge.exposeInMainWorld('diskClean'")
    expect(preload).not.toMatch(/exposeInMainWorld\(\s*['"]ipcRenderer['"]/)
    expect(preload).toContain('invokeProviderIpc')
    expect(preload).toContain('ProviderInvokeError')
    expect(dts).not.toMatch(/getDecryptedApiKey|decryptApiKey|apiKey:\s*string/)

    for (const method of [
      'getProviderConfig',
      'saveProviderConfig',
      'deleteProviderApiKey',
      'testProviderConnection',
      'testProviderCapability'
    ]) {
      expect(preload).toContain(method)
      expect(dts).toContain(method)
    }
  })

  it('provider IPC handlers use structured result contract', () => {
    const ipc = readFileSync(join(process.cwd(), 'src/main/provider/provider-ipc.ts'), 'utf-8')
    expect(ipc).toMatch(/providerIpcOk/)
    expect(ipc).toMatch(/providerIpcFail/)
    expect(ipc).not.toMatch(/serializeProviderError/)
    expect(ipc).toMatch(/isTrustedMainWindowSender/)
  })

  it('public provider config type excludes plaintext key', () => {
    const types = readFileSync(join(process.cwd(), 'src/shared/provider-types.ts'), 'utf-8')
    expect(types).toMatch(/hasKey:\s*boolean/)
    expect(types).toMatch(/keyLastFour\?:/)
    expect(types).not.toMatch(/apiKey:\s*string/)
  })
})

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderConfigStore, type SafeStorageAdapter } from '../src/main/provider/provider-config-store'
import {
  createProviderProfile,
  listProviderProfiles,
  requireRunnableConfig,
  setActiveProviderProfile,
  setProviderStoreForTests,
  testProviderConnection
} from '../src/main/provider/provider-service'
import {
  notifyNewScanSession,
  runAgentAnalysis,
  setAgentFetchForTests
} from '../src/main/agent/agent-service'
import { createScanSession, clearScanSession } from '../src/main/scan/scan-session-store'
import { normalizeCandidate } from '../src/shared/candidate-model'
import {
  AgentAnalysisState,
  setAgentAnalysisStateForTests
} from '../src/main/agent/agent-analysis-state'
import type { ScanItem } from '../src/shared/types'

const OPENAI_KEY = 'sk-openai-agent-key-11111111'
const DEEPSEEK_KEY = 'sk-deepseek-agent-key-22222222'

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
  setAgentFetchForTests(undefined)
  setAgentAnalysisStateForTests(new AgentAnalysisState())
  clearScanSession()
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function installStore(): ProviderConfigStore {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-agent-profiles-'))
  tempDirs.push(dir)
  const store = new ProviderConfigStore({
    configPath: join(dir, 'provider-config.json'),
    safeStorage: mockSafeStorage()
  })
  setProviderStoreForTests(store)
  return store
}

function scanItem(id: string): ScanItem {
  return normalizeCandidate({
    id,
    ruleId: 'rule-a',
    ruleName: 'Temp',
    category: 'safe',
    contentType: 'system-temp',
    drive: 'C:',
    path: `C:\\Temp\\${id}.tmp`,
    size: 100,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'file',
    deletable: true,
    autoSelect: true,
    source: 'rule',
    reason: 'temp',
    discoverySources: ['rule'],
    evidence: [],
    judgment: { status: 'suggested', source: 'legacy-rule', confidence: 'high', basis: ['rule'] },
    selection: { selectable: true },
    suggestedAction: 'recycle'
  })
}

describe('agent active provider profile', () => {
  it('uses active profile for new requests and keeps in-flight snapshot after switch', async () => {
    installStore()
    const openAi = createProviderProfile({
      name: 'OpenAI',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: OPENAI_KEY
    })
    const openAiId = openAi.activeProfileId!

    const deepSeek = createProviderProfile({
      name: 'DeepSeek',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: DEEPSEEK_KEY
    })
    const deepSeekId = deepSeek.profiles.find((p) => p.name === 'DeepSeek')!.id

    setActiveProviderProfile(openAiId)
    expect(requireRunnableConfig().apiKey).toBe(OPENAI_KEY)

    setActiveProviderProfile(deepSeekId)
    expect(requireRunnableConfig().apiKey).toBe(DEEPSEEK_KEY)

    const session = createScanSession('C:', 'combined', 'v1', [scanItem('a')])
    notifyNewScanSession(session.sessionId)

    let capturedUrl = ''
    let resolveFetch: (() => void) | null = null
    const fetchGate = new Promise<void>((resolve) => {
      resolveFetch = resolve
    })

    setAgentFetchForTests(
      (async (url) => {
        capturedUrl = String(url)
        await fetchGate
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    schemaVersion: '1',
                    summary: { headline: 'ok', overview: 'ok' },
                    recommendations: []
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      }) as typeof fetch
    )

    setActiveProviderProfile(openAiId)
    const analysisPromise = runAgentAnalysis({ sessionId: session.sessionId })

    setActiveProviderProfile(deepSeekId)
    resolveFetch?.()
    await analysisPromise

    expect(capturedUrl).toContain('api.openai.com')
    expect(capturedUrl).not.toContain('deepseek.com')
  })

  it('returns CONFIG_MISSING when profile has no key', async () => {
    installStore()
    const created = createProviderProfile({
      name: 'No Key',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    })

    const result = await testProviderConnection(created.profiles[0].id)
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('CONFIG_MISSING')
  })

  it('does not auto-fallback to another profile when active has no key', async () => {
    installStore()
    createProviderProfile({
      name: 'With Key',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: OPENAI_KEY
    })
    const noKey = createProviderProfile({
      name: 'No Key',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    })
    setActiveProviderProfile(noKey.profiles.find((p) => p.name === 'No Key')!.id)

    const session = createScanSession('C:', 'combined', 'v1', [scanItem('a')])
    notifyNewScanSession(session.sessionId)
    const result = await runAgentAnalysis({ sessionId: session.sessionId })
    expect(result.analysis.status).toBe('skipped_no_provider')
    expect(listProviderProfiles().profiles).toHaveLength(2)
  })
})

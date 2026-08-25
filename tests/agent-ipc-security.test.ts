import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { handleAgentAnalyze } from '../src/main/agent/agent-ipc'
import { clearScanSession, createScanSession } from '../src/main/scan/scan-session-store'
import {
  AgentAnalysisState,
  setAgentAnalysisStateForTests
} from '../src/main/agent/agent-analysis-state'
import { markAgentScanStarting, notifyNewScanSession, setAgentFetchForTests } from '../src/main/agent/agent-service'
import { ProviderConfigStore, type SafeStorageAdapter } from '../src/main/provider/provider-config-store'
import { saveProviderConfig, setProviderStoreForTests } from '../src/main/provider/provider-service'
import { setTrustedSenderCheckerForTests } from '../src/main/window-security'
import { normalizeCandidate } from '../src/shared/candidate-model'

function mockSafeStorage(): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(`enc:${plainText}`, 'utf-8'),
    decryptString: (encrypted) => encrypted.toString('utf-8').replace(/^enc:/, '')
  }
}

function installEmptyProvider(): void {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-agent-ipc-'))
  const store = new ProviderConfigStore({
    configPath: join(dir, 'provider-config.json'),
    safeStorage: mockSafeStorage()
  })
  setProviderStoreForTests(store)
}

function installProvider(): void {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-agent-ipc-provider-'))
  const store = new ProviderConfigStore({
    configPath: join(dir, 'provider-config.json'),
    safeStorage: mockSafeStorage()
  })
  setProviderStoreForTests(store)
  saveProviderConfig({
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: 'sk-test-secret-key-12345678'
  })
}

function scanItem(): ReturnType<typeof normalizeCandidate> {
  return normalizeCandidate({
    id: 'a',
    ruleId: 'rule-a',
    ruleName: 'Temp',
    category: 'safe',
    contentType: 'system-temp',
    drive: 'C:',
    path: 'C:\\Temp\\a.tmp',
    size: 1,
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

describe('agent ipc security', () => {
  afterEach(() => {
    setTrustedSenderCheckerForTests(null)
    setProviderStoreForTests(null)
    setAgentFetchForTests(undefined)
    setAgentAnalysisStateForTests(new AgentAnalysisState())
    clearScanSession()
    vi.useRealTimers()
  })

  it('rejects untrusted sender', async () => {
    setTrustedSenderCheckerForTests(() => false)
    const result = await handleAgentAnalyze({ sender: { id: 1 } } as never, {
      sessionId: 'x'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('IPC_UNAUTHORIZED')
  })

  it('only accepts sessionId in analyze request contract', () => {
    const preload = readFileSync(join(process.cwd(), 'src/preload/index.ts'), 'utf-8')
    expect(preload).toContain("invokeAgentIpc<AgentAnalyzeResult>('agent:analyze', request)")
    expect(preload).not.toContain('candidateIds')
    expect(preload).not.toContain('apiKey')
  })

  it('rejects invalid session id input', async () => {
    setTrustedSenderCheckerForTests(() => true)
    const result = await handleAgentAnalyze({ sender: { id: 1 } } as never, {
      sessionId: '   '
    })
    expect(result.ok).toBe(false)
  })

  it('returns session not found without renderer-supplied candidates', async () => {
    setTrustedSenderCheckerForTests(() => true)
    const result = await handleAgentAnalyze({ sender: { id: 1 } } as never, {
      sessionId: 'missing-session'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('SESSION_NOT_FOUND')
  })

  it('reads candidates from scan session store only', async () => {
    installEmptyProvider()
    setTrustedSenderCheckerForTests(() => true)
    const session = createScanSession('C:', 'combined', 'v1', [scanItem()])
    notifyNewScanSession(session.sessionId)
    const result = await handleAgentAnalyze({ sender: { id: 1 } } as never, {
      sessionId: session.sessionId
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.analysis.status).toBe('skipped_no_provider')
      expect(result.value.items).toHaveLength(1)
    }
  })

  it('returns TIMEOUT through IPC when model request times out', async () => {
    vi.useFakeTimers()
    try {
      installProvider()
      setTrustedSenderCheckerForTests(() => true)
      const session = createScanSession('C:', 'combined', 'v1', [scanItem()])
      notifyNewScanSession(session.sessionId)
      setAgentFetchForTests(
        vi.fn((_url, init) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted')
              err.name = 'AbortError'
              reject(err)
            })
          })
        }) as typeof fetch
      )

      const resultPromise = handleAgentAnalyze({ sender: { id: 1 } } as never, {
        sessionId: session.sessionId
      })
      const assertion = expect(resultPromise).resolves.toMatchObject({
        ok: false,
        code: 'TIMEOUT'
      })
      await vi.advanceTimersByTimeAsync(61_000)
      await assertion
      const result = await resultPromise
      if (!result.ok) {
        expect(result.code).not.toBe('CANCELLED')
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns SESSION_STALE through IPC when a new scan supersedes analysis', async () => {
    installProvider()
    setTrustedSenderCheckerForTests(() => true)
    const oldSession = createScanSession('C:', 'combined', 'v1', [scanItem()])
    notifyNewScanSession(oldSession.sessionId)

    let resolveFetch: (value: Response) => void = () => undefined
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    setAgentFetchForTests(vi.fn(() => fetchPromise) as typeof fetch)

    const resultPromise = handleAgentAnalyze({ sender: { id: 1 } } as never, {
      sessionId: oldSession.sessionId
    })
    markAgentScanStarting()
    const newSession = createScanSession('C:', 'combined', 'v1', [scanItem()])
    notifyNewScanSession(newSession.sessionId)

    resolveFetch(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: '1',
                  summary: { headline: 'late', overview: 'late' },
                  recommendations: []
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    )

    const result = await resultPromise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(['SESSION_STALE', 'CANCELLED']).toContain(result.code)
      expect(result.code).not.toBe('TIMEOUT')
    }
  })
})

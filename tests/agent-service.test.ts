import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderConfigStore, type SafeStorageAdapter } from '../src/main/provider/provider-config-store'
import { saveProviderConfig, setProviderStoreForTests } from '../src/main/provider/provider-service'
import { createScanSession, clearScanSession } from '../src/main/scan/scan-session-store'
import { normalizeCandidate } from '../src/shared/candidate-model'
import {
  cancelAgentAnalysis,
  markAgentScanStarting,
  notifyNewScanSession,
  runAgentAnalysis,
  setAgentFetchForTests
} from '../src/main/agent/agent-service'
import {
  AgentAnalysisState,
  setAgentAnalysisStateForTests
} from '../src/main/agent/agent-analysis-state'
import type { ScanItem } from '../src/shared/types'

const API_KEY = 'sk-test-secret-key-12345678'

function mockSafeStorage(): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(`enc:${plainText}`, 'utf-8'),
    decryptString: (encrypted) => encrypted.toString('utf-8').replace(/^enc:/, '')
  }
}

const tempDirs: string[] = []

function installEmptyProvider(): void {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-agent-empty-'))
  tempDirs.push(dir)
  const store = new ProviderConfigStore({
    configPath: join(dir, 'provider-config.json'),
    safeStorage: mockSafeStorage()
  })
  setProviderStoreForTests(store)
}

afterEach(() => {
  setProviderStoreForTests(null)
  setAgentFetchForTests(undefined)
  setAgentAnalysisStateForTests(new AgentAnalysisState())
  clearScanSession()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function installProvider(): void {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-agent-'))
  tempDirs.push(dir)
  const store = new ProviderConfigStore({
    configPath: join(dir, 'provider-config.json'),
    safeStorage: mockSafeStorage()
  })
  setProviderStoreForTests(store)
  saveProviderConfig({
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: API_KEY
  })
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

function mockModelResponse(): typeof fetch {
  return vi.fn(async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                schemaVersion: '1',
                summary: { headline: '建议', overview: '概述' },
                recommendations: [
                  {
                    candidateRef: 'candidate-1',
                    verdict: 'clean',
                    likelyContent: '缓存',
                    reason: '可清理',
                    impact: '影响小',
                    confidence: 'high',
                    basis: ['临时文件']
                  }
                ]
              })
            }
          }
        ]
      }),
      { status: 200 }
    )
  }) as typeof fetch
}

describe('agent service', () => {
  it('skips analysis without provider key and keeps scan items', async () => {
    installEmptyProvider()
    const session = createScanSession('C:', 'combined', 'v1', [scanItem('a')])
    notifyNewScanSession(session.sessionId)
    const result = await runAgentAnalysis({ sessionId: session.sessionId })
    expect(result.analysis.status).toBe('skipped_no_provider')
    expect(result.items).toHaveLength(1)
  })

  it('runs single analysis after scan completes with mock model', async () => {
    installProvider()
    const session = createScanSession('C:', 'combined', 'v1', [scanItem('a')])
    notifyNewScanSession(session.sessionId)
    setAgentFetchForTests(mockModelResponse())

    const result = await runAgentAnalysis({ sessionId: session.sessionId })
    expect(result.analysis.status).toBe('completed')
    expect(result.items[0]?.judgment.source).toBe('agent')
    expect(JSON.stringify(result)).not.toContain(API_KEY)
  })

  it('allows retry on same session after failure', async () => {
    installProvider()
    const session = createScanSession('C:', 'combined', 'v1', [scanItem('a')])
    notifyNewScanSession(session.sessionId)

    let calls = 0
    setAgentFetchForTests(
      vi.fn(async () => {
        calls += 1
        if (calls === 1) return new Response('not-json', { status: 200 })
        return (await mockModelResponse()('', {} as RequestInit)) as Response
      }) as typeof fetch
    )

    await expect(runAgentAnalysis({ sessionId: session.sessionId })).rejects.toMatchObject({
      code: 'RESPONSE_INVALID'
    })
    const retry = await runAgentAnalysis({ sessionId: session.sessionId, retry: true })
    expect(retry.analysis.status).toBe('completed')
  })

  it('rejects stale session responses after new scan starts', async () => {
    installProvider()
    const oldSession = createScanSession('C:', 'combined', 'v1', [scanItem('old')])
    notifyNewScanSession(oldSession.sessionId)

    let capturedSignal: AbortSignal | undefined
    let resolveFetch: (value: Response) => void = () => undefined
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    setAgentFetchForTests(
      vi.fn((_url, init) => {
        capturedSignal = init?.signal as AbortSignal | undefined
        return fetchPromise
      }) as typeof fetch
    )

    const analysisPromise = runAgentAnalysis({ sessionId: oldSession.sessionId })
    markAgentScanStarting()
    const newSession = createScanSession('C:', 'combined', 'v1', [scanItem('new')])
    notifyNewScanSession(newSession.sessionId)

    expect(capturedSignal?.aborted).toBe(true)

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

    await expect(analysisPromise).rejects.toMatchObject({ code: 'SESSION_STALE' })
  })

  it('prevents duplicate auto analysis on same session', async () => {
    installProvider()
    const session = createScanSession('C:', 'combined', 'v1', [scanItem('a')])
    notifyNewScanSession(session.sessionId)
    setAgentFetchForTests(mockModelResponse())

    await runAgentAnalysis({ sessionId: session.sessionId })
    await expect(runAgentAnalysis({ sessionId: session.sessionId })).rejects.toMatchObject({
      code: 'ANALYSIS_ALREADY_DONE'
    })
  })

  it('maps provider timeout to Agent TIMEOUT without reporting CANCELLED', async () => {
    vi.useFakeTimers()
    try {
      installProvider()
      const session = createScanSession('C:', 'combined', 'v1', [scanItem('a')])
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

      const analysisPromise = runAgentAnalysis({ sessionId: session.sessionId })
      const assertion = expect(analysisPromise).rejects.toMatchObject({
        code: 'TIMEOUT',
        message: '连接超时'
      })
      await vi.advanceTimersByTimeAsync(61_000)
      await assertion
      await expect(analysisPromise).rejects.not.toMatchObject({ code: 'CANCELLED' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps active cancellation to CANCELLED when session is still latest', async () => {
    installProvider()
    const session = createScanSession('C:', 'combined', 'v1', [scanItem('a')])
    notifyNewScanSession(session.sessionId)

    let resolveFetch: (value: Response) => void = () => undefined
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    setAgentFetchForTests(vi.fn(() => fetchPromise) as typeof fetch)

    const analysisPromise = runAgentAnalysis({ sessionId: session.sessionId })
    cancelAgentAnalysis()

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

    await expect(analysisPromise).rejects.toMatchObject({ code: 'CANCELLED' })
    await expect(analysisPromise).rejects.not.toMatchObject({ code: 'TIMEOUT' })
  })
})

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderConfigStore, type SafeStorageAdapter } from '../src/main/provider/provider-config-store'
import { saveProviderConfig, setProviderStoreForTests } from '../src/main/provider/provider-service'
import { createScanSession, clearScanSession } from '../src/main/scan/scan-session-store'
import { normalizeCandidate } from '../src/shared/candidate-model'
import { buildCandidateRefIndex } from '../src/shared/candidate-ref-index'
import { buildAgentInvestigationCandidates } from '../src/shared/agent-candidate-prep'
import {
  InvestigationRuntime,
  setInvestigationRuntimeForTests
} from '../src/main/agent/investigation/investigation-runtime'
import {
  InvestigationResultCache,
  setInvestigationResultCacheForTests
} from '../src/main/agent/investigation/investigation-cache'
import { onNewScanSession } from '../src/main/agent/investigation/investigation-service'
import * as investigationService from '../src/main/agent/investigation/investigation-service'
import * as agentPrompt from '../src/main/agent/agent-prompt'
import { runInvestigationOrchestration } from '../src/main/agent/investigation/investigation-orchestrator'
import {
  clearCandidateRefMaps,
  getRegisteredRefMap
} from '../src/main/agent/investigation/candidate-ref'
import { INVESTIGATION_LIMITS } from '../src/shared/investigation-limits'
import type { ScanItem } from '../src/shared/types'

const API_KEY = 'sk-test-secret-key-12345678'
const tempDirs: string[] = []

function mockSafeStorage(): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf-8'),
    decryptString: (encrypted) => encrypted.toString('utf-8').replace(/^enc:/, '')
  }
}

function installProvider(): void {
  const dir = mkdtempSync(join(tmpdir(), 'disk-clean-orch-'))
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

function analyzerItem(path: string, id: string, size = 200 * 1024 * 1024): ScanItem {
  return normalizeCandidate({
    id,
    ruleId: '__analyzer__',
    ruleName: 'Large Dir',
    category: 'dangerous',
    contentType: 'large-dir',
    drive: 'C:',
    path,
    size,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    deletable: false,
    autoSelect: false,
    source: 'analyzer',
    discoverySources: ['analyzer'],
    evidence: [],
    judgment: { status: 'uncertain', source: 'analyzer', confidence: 'low', basis: ['size'] },
    selection: { selectable: false }
  })
}

function buildOrchestrationInput(
  session: ReturnType<typeof createScanSession>,
  refIndex: ReturnType<typeof buildCandidateRefIndex>,
  investigationCandidates: ReturnType<typeof buildAgentInvestigationCandidates>
) {
  return {
    session,
    refIndex,
    investigationCandidates,
    profile: {
      profileId: 'p1',
      config: {
        providerId: 'openai' as const,
        protocol: 'openai' as const,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        hasKey: true,
        keyLastFour: '5678'
      },
      apiKey: API_KEY
    },
    requestId: 'req-ref-release',
    generation: 'gen-ref-release',
    signal: new AbortController().signal,
    isActive: () => true,
    fetchFn: vi.fn()
  }
}

afterEach(() => {
  setProviderStoreForTests(null)
  clearScanSession()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('investigation orchestrator', () => {
  beforeEach(() => {
    setInvestigationRuntimeForTests(new InvestigationRuntime())
    setInvestigationResultCacheForTests(new InvestigationResultCache())
    installProvider()
  })

  it('runs two-round flow: investigate then final', async () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-orch-root-'))
    tempDirs.push(root)
    mkdirSync(join(root, 'cache'))
    writeFileSync(join(root, 'cache', 'a.tmp'), 'hello')

    const item = analyzerItem(root, 'item-a')
    const session = createScanSession('C:', 'full', 'v1', [item])
    const fingerprint = `${session.sessionId}:${session.createdAt}:${session.revision}`
    onNewScanSession(fingerprint)
    const refIndex = buildCandidateRefIndex([item], fingerprint, session.revision)
    const investigationCandidates = buildAgentInvestigationCandidates([item], { refIndex })

    let call = 0
    const fetchFn = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    schemaVersion: 1,
                    action: 'investigate',
                    purpose: '查看目录构成',
                    calls: [
                      {
                        candidateRef: 'candidate-1',
                        tool: 'summarize_directory',
                        relativePath: '.',
                        depth: 1
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: '1',
                  summary: { headline: '可清理', overview: '缓存目录' },
                  recommendations: [
                    {
                      candidateRef: 'candidate-1',
                      verdict: 'confirm',
                      likelyContent: '缓存',
                      reason: '可清理',
                      impact: '小',
                      confidence: 'medium',
                      basis: ['调查']
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    })

    const controller = new AbortController()
    const result = await runInvestigationOrchestration({
      session,
      refIndex,
      investigationCandidates,
      profile: {
        profileId: 'p1',
        config: {
          providerId: 'openai',
          protocol: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          hasKey: true,
          keyLastFour: '5678'
        },
        apiKey: API_KEY
      },
      requestId: 'req-1',
      generation: 'gen-1',
      signal: controller.signal,
      isActive: () => true,
      fetchFn
    })

    expect(result.parsed.summary.headline).toBe('可清理')
    expect(result.investigation.toolCallCount).toBe(1)
    expect(result.investigation.roundCount).toBe(2)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('completes in one round with legacy final', async () => {
    const item = analyzerItem('C:\\Temp\\only', 'only')
    const session = createScanSession('C:', 'full', 'v1', [item])
    const fingerprint = `${session.sessionId}:${session.createdAt}:${session.revision}`
    onNewScanSession(fingerprint)
    const refIndex = buildCandidateRefIndex([item], fingerprint, session.revision)

    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: '1',
                  summary: { headline: '保留', overview: '不确定' },
                  recommendations: []
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    )

    const result = await runInvestigationOrchestration({
      session,
      refIndex,
      investigationCandidates: buildAgentInvestigationCandidates([item], { refIndex }),
      profile: {
        profileId: 'p1',
        config: {
          providerId: 'openai',
          protocol: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          hasKey: true,
          keyLastFour: '5678'
        },
        apiKey: API_KEY
      },
      requestId: 'req-2',
      generation: 'gen-2',
      signal: new AbortController().signal,
      isActive: () => true,
      fetchFn
    })

    expect(result.investigation.toolCallCount).toBe(0)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('returns uncertain when advanceInvestigationRound reports budget exhausted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-orch-budget-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'a.tmp'), 'hello')

    const item = analyzerItem(root, 'item-a')
    const session = createScanSession('C:', 'full', 'v1', [item])
    const fingerprint = `${session.sessionId}:${session.createdAt}:${session.revision}`
    onNewScanSession(fingerprint)
    const refIndex = buildCandidateRefIndex([item], fingerprint, session.revision)
    const investigationCandidates = buildAgentInvestigationCandidates([item], { refIndex })

    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  action: 'investigate',
                  purpose: '查看',
                  calls: [
                    {
                      candidateRef: 'candidate-1',
                      tool: 'list_children',
                      relativePath: '.'
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    )

    const advanceSpy = vi.spyOn(investigationService, 'advanceInvestigationRound').mockReturnValue({
      sessionId: session.sessionId,
      fingerprint,
      phase: 'uncertain',
      budget: {
        rounds: INVESTIGATION_LIMITS.MAX_ROUNDS,
        toolCallsThisRound: 0,
        totalToolCalls: INVESTIGATION_LIMITS.MAX_TOTAL_TOOL_CALLS,
        totalResponseBytes: 0
      },
      lastErrorCode: 'TOOL_LIMIT_EXCEEDED',
      lastErrorMessage: '调查预算已用尽，无法进一步确定'
    })

    const result = await runInvestigationOrchestration({
      session,
      refIndex,
      investigationCandidates,
      profile: {
        profileId: 'p1',
        config: {
          providerId: 'openai',
          protocol: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          hasKey: true,
          keyLastFour: '5678'
        },
        apiKey: API_KEY
      },
      requestId: 'req-budget',
      generation: 'gen-budget',
      signal: new AbortController().signal,
      isActive: () => true,
      fetchFn
    })

    advanceSpy.mockRestore()
    expect(result.uncertain).toBe(true)
    expect(result.parsed.summary.headline).toContain('无法确定')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('returns uncertain after MAX_ROUNDS without throwing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-orch-rounds-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'a.tmp'), 'hello')

    const item = analyzerItem(root, 'item-a')
    const session = createScanSession('C:', 'full', 'v1', [item])
    const fingerprint = `${session.sessionId}:${session.createdAt}:${session.revision}`
    onNewScanSession(fingerprint)
    const refIndex = buildCandidateRefIndex([item], fingerprint, session.revision)
    const investigationCandidates = buildAgentInvestigationCandidates([item], { refIndex })

    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  action: 'investigate',
                  purpose: '继续查看',
                  calls: [
                    {
                      candidateRef: 'candidate-1',
                      tool: 'list_children',
                      relativePath: '.'
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    )

    const result = await runInvestigationOrchestration({
      session,
      refIndex,
      investigationCandidates,
      profile: {
        profileId: 'p1',
        config: {
          providerId: 'openai',
          protocol: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          hasKey: true,
          keyLastFour: '5678'
        },
        apiKey: API_KEY
      },
      requestId: 'req-rounds',
      generation: 'gen-rounds',
      signal: new AbortController().signal,
      isActive: () => true,
      fetchFn
    })

    expect(result.uncertain).toBe(true)
    expect(result.investigation.roundCount).toBe(INVESTIGATION_LIMITS.MAX_ROUNDS)
    expect(fetchFn).toHaveBeenCalledTimes(INVESTIGATION_LIMITS.MAX_ROUNDS)
  })

  it('releases ref map when startInvestigation fails', async () => {
    clearCandidateRefMaps()
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-orch-start-fail-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'a.tmp'), 'hello')

    const item = analyzerItem(root, 'item-a')
    const session = createScanSession('C:', 'full', 'v1', [item])
    const fingerprint = `${session.sessionId}:${session.createdAt}:${session.revision}`
    onNewScanSession(fingerprint)
    const refIndex = buildCandidateRefIndex([item], fingerprint, session.revision)
    const investigationCandidates = buildAgentInvestigationCandidates([item], { refIndex })

    const startSpy = vi.spyOn(investigationService, 'startInvestigation').mockImplementation(() => {
      throw new Error('INVESTIGATION_NOT_ACTIVE')
    })

    await expect(
      runInvestigationOrchestration(buildOrchestrationInput(session, refIndex, investigationCandidates))
    ).rejects.toThrow('INVESTIGATION_NOT_ACTIVE')
    expect(getRegisteredRefMap(fingerprint)).toBeUndefined()
    startSpy.mockRestore()
  })

  it('releases ref map when prompt build fails', async () => {
    clearCandidateRefMaps()
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-orch-prompt-fail-'))
    tempDirs.push(root)
    writeFileSync(join(root, 'a.tmp'), 'hello')

    const item = analyzerItem(root, 'item-a')
    const session = createScanSession('C:', 'full', 'v1', [item])
    const fingerprint = `${session.sessionId}:${session.createdAt}:${session.revision}`
    onNewScanSession(fingerprint)
    const refIndex = buildCandidateRefIndex([item], fingerprint, session.revision)
    const investigationCandidates = buildAgentInvestigationCandidates([item], { refIndex })

    const promptSpy = vi.spyOn(agentPrompt, 'buildAgentMessages').mockImplementation(() => {
      throw new Error('prompt build failed')
    })

    await expect(
      runInvestigationOrchestration(buildOrchestrationInput(session, refIndex, investigationCandidates))
    ).rejects.toThrow('prompt build failed')
    expect(getRegisteredRefMap(fingerprint)).toBeUndefined()
    promptSpy.mockRestore()
  })
})

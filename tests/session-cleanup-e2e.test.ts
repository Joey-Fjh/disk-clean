import { mkdtempSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createScanSession, updateScanSessionCandidates } from '../src/main/scan/scan-session-store'
import { mapSpaceScanItem, normalizeCandidate } from '../src/shared/candidate-model'
import { finalizeLocalScanItem } from '../src/shared/candidate-judgment'
import { markCandidateAgentConfirmable } from '../src/shared/execution-safety'
import { applyAgentRecommendation, applyAgentRecommendations } from '../src/main/agent/agent-candidate-mapper'
import {
  executeConfirmedCleanup,
  prepareCleanupConfirmation,
  runCleanupForTests
} from '../src/main/cleanup/cleanup-service'
import { buildSessionFingerprint } from '../src/shared/candidate-ref-index'
import { measurePathDetailed } from '../src/main/scanner/measure-size'
import type { ScanCandidate, ScanItem } from '../src/shared/types'
import { CleanupServiceError } from '../src/main/cleanup/cleanup-errors'
import { clearCleanupConfirmationStoreForTests } from '../src/main/cleanup/cleanup-confirmation-store'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(async () => undefined) }
}))

const ruleRoot = mkdtempSync(join(tmpdir(), 'disk-clean-phase6-'))
const cacheDir = join(ruleRoot, 'cache')
mkdirSync(cacheDir, { recursive: true })
writeFileSync(join(cacheDir, 'thumb.dat'), 'x'.repeat(200))

const testRule = {
  id: 'test-cache',
  name: '测试缓存',
  category: 'safe' as const,
  paths: [ruleRoot],
  subdirs: ['cache'],
  defaultChecked: true,
  enabled: true,
  source: 'builtin' as const,
  cleanupMethod: 'trash' as const
}

vi.mock('../src/main/rules', () => ({
  getProtectedPaths: () => [],
  getPathAccessPolicy: () => ({ denyRead: [], readOnlyHighRisk: [], denyDelete: [] }),
  getAllRulesWithMeta: () => [testRule]
}))

const cacheStat = statSync(cacheDir)

function makeRuleCandidate(id: string, path: string, size: number): ScanCandidate {
  return normalizeCandidate({
    id,
    ruleId: 'test-cache',
    ruleName: '测试缓存',
    category: 'safe',
    contentType: 'app-cache',
    drive: 'C:',
    path,
    size,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    mtimeMs: cacheStat.mtimeMs,
    deletable: true,
    autoSelect: true,
    source: 'rule',
    ruleSource: 'builtin',
    discoverySources: ['rule'],
    evidence: [],
    judgment: {
      status: 'suggested',
      source: 'legacy-rule',
      confidence: 'high',
      basis: ['规则命中'],
      judgmentOrigin: 'local-rule'
    },
    executionSafety: 'rule-eligible',
    selection: { selectable: true },
    suggestedAction: 'recycle'
  })
}

function buildSpaceScanPipelineItem(path: string, size: number): ScanItem {
  const raw: ScanItem = {
    id: 'space-agent-1',
    ruleId: '__analyzer__',
    ruleName: '大型目录',
    category: 'recommended',
    contentType: 'large-dir',
    drive: 'C:',
    path,
    size,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    mtimeMs: statSync(path).mtimeMs,
    deletable: false,
    autoSelect: false,
    source: 'analyzer',
    reason: '磁盘空间占用分析（逻辑大小估算）',
    impact: 'Agent 调查后可申请清理授权',
    discoverySources: ['space-scan'],
    evidence: [],
    judgment: {
      status: 'identifying',
      source: 'none',
      confidence: 'unknown',
      basis: ['空间扫描'],
      judgmentOrigin: 'space-evidence-only'
    },
    selection: { selectable: false },
    suggestedAction: 'none'
  }

  let item = mapSpaceScanItem(raw)
  return normalizeCandidate(finalizeLocalScanItem(item, false))
}

function buildRealAgentPipelineItem(path: string, size: number): ScanItem {
  const item = buildSpaceScanPipelineItem(path, size)
  return normalizeCandidate(
    applyAgentRecommendation(normalizeCandidate(markCandidateAgentConfirmable(item)), {
      candidateRef: 'candidate-1',
      verdict: 'clean',
      likelyContent: '临时缓存目录',
      reason: '可安全清理',
      impact: '应用会重建',
      confidence: 'high',
      basis: ['Agent 明确建议清理']
    })
  )
}

describe('session cleanup e2e', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    clearCleanupConfirmationStoreForTests()
  })

  it('runs scan → prepare → confirm → execute for local-rule candidate', async () => {
    const size = (await measurePathDetailed(cacheDir, 32)).size
    const session = createScanSession('C:', 'combined', 'v1', [makeRuleCandidate('c1', cacheDir, size)])
    const fingerprint = buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)

    const preview = prepareCleanupConfirmation({
      sessionId: session.sessionId,
      fingerprint,
      candidateIds: ['c1']
    })
    const result = await executeConfirmedCleanup(preview.confirmationId)
    expect(result.moved).toBe(1)
    expect(result.postReview).toBeDefined()
  })

  it('runs production map→finalize→applyAgentRecommendations→prepare→execute path', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'disk-clean-agent-prod-'))
    writeFileSync(join(agentDir, 'blob.bin'), 'agent-data')
    const size = (await measurePathDetailed(agentDir, 32)).size
    let item = buildSpaceScanPipelineItem(agentDir, size)
    const refToId = new Map([['candidate-1', item.id]])
    const { items, appliedCount } = applyAgentRecommendations(
      [item],
      [
        {
          candidateRef: 'candidate-1',
          verdict: 'clean',
          likelyContent: '临时缓存目录',
          reason: '可安全清理',
          impact: '应用会重建',
          confidence: 'high',
          basis: ['Agent 明确建议清理']
        }
      ],
      refToId,
      []
    )
    expect(appliedCount).toBe(1)
    item = items[0]!
    expect(item.executionSafety).toBe('agent-confirmable')
    expect(item.judgment.judgmentOrigin).toBe('agent-session')
    expect(item.selection.selectable).toBe(true)

    const session = createScanSession('C:', 'combined', 'v1', [item])
    updateScanSessionCandidates(session.sessionId, [item])
    const fingerprint = buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)

    const preview = prepareCleanupConfirmation({
      sessionId: session.sessionId,
      fingerprint,
      candidateIds: [item.id]
    })
    expect(preview.itemCount).toBe(1)
    const result = await executeConfirmedCleanup(preview.confirmationId)
    expect(result.moved).toBe(1)
  })

  it('rejects keep verdict from production applyAgentRecommendations batch', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'disk-clean-agent-keep-'))
    writeFileSync(join(agentDir, 'blob.bin'), 'agent-data')
    const size = (await measurePathDetailed(agentDir, 32)).size
    const item = buildSpaceScanPipelineItem(agentDir, size)
    const refToId = new Map([['candidate-1', item.id]])
    const { items } = applyAgentRecommendations(
      [item],
      [
        {
          candidateRef: 'candidate-1',
          verdict: 'keep',
          likelyContent: '用户数据',
          reason: '应保留',
          impact: '删除会影响使用',
          confidence: 'high',
          basis: ['Agent 建议保留']
        }
      ],
      refToId,
      []
    )
    expect(items[0]?.selection.selectable).toBe(false)
    const session = createScanSession('C:', 'combined', 'v1', [items[0]!])
    const fingerprint = buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)
    expect(() =>
      prepareCleanupConfirmation({
        sessionId: session.sessionId,
        fingerprint,
        candidateIds: [items[0]!.id]
      })
    ).toThrow(CleanupServiceError)
  })

  it('runs real scan pipeline for agent-session without JSON rules', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'disk-clean-agent-real-'))
    writeFileSync(join(agentDir, 'blob.bin'), 'agent-data')
    const size = (await measurePathDetailed(agentDir, 32)).size
    const item = buildRealAgentPipelineItem(agentDir, size)
    expect(item.executionSafety).toBe('agent-confirmable')
    expect(item.judgment.judgmentOrigin).toBe('agent-session')
    expect(item.selection.selectable).toBe(true)

    const session = createScanSession('C:', 'combined', 'v1', [item])
    updateScanSessionCandidates(session.sessionId, [item])
    const fingerprint = buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)

    const preview = prepareCleanupConfirmation({
      sessionId: session.sessionId,
      fingerprint,
      candidateIds: [item.id]
    })
    expect(preview.itemCount).toBe(1)
    const result = await executeConfirmedCleanup(preview.confirmationId)
    expect(result.moved).toBe(1)
  })

  it('rejects advice-only space item even when agent says clean without investigation promotion', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'disk-clean-agent-blocked-'))
    writeFileSync(join(agentDir, 'blob.bin'), 'agent-data')
    const size = (await measurePathDetailed(agentDir, 32)).size
    let item = buildRealAgentPipelineItem(agentDir, size)
    item = normalizeCandidate({ ...item, executionSafety: 'advice-only' })
    item = applyAgentRecommendation(item, {
      candidateRef: 'candidate-1',
      verdict: 'clean',
      likelyContent: 'x',
      reason: 'x',
      impact: 'x',
      confidence: 'high',
      basis: ['x']
    })
    expect(item.selection.selectable).toBe(false)
    const session = createScanSession('C:', 'combined', 'v1', [item])
    const fingerprint = buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)
    expect(() =>
      prepareCleanupConfirmation({
        sessionId: session.sessionId,
        fingerprint,
        candidateIds: [item.id]
      })
    ).toThrow(CleanupServiceError)
  })

  it('rejects stale fingerprint at prepare time', async () => {
    const size = (await measurePathDetailed(cacheDir, 32)).size
    const session = createScanSession('C:', 'combined', 'v1', [makeRuleCandidate('c1', cacheDir, size)])
    expect(() =>
      prepareCleanupConfirmation({
        sessionId: session.sessionId,
        fingerprint: 'stale-fingerprint',
        candidateIds: ['c1']
      })
    ).toThrow(CleanupServiceError)
  })

  it('rejects stale revision at execute time', async () => {
    const size = (await measurePathDetailed(cacheDir, 32)).size
    const session = createScanSession('C:', 'combined', 'v1', [makeRuleCandidate('c1', cacheDir, size)])
    const fingerprint = buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)
    const preview = prepareCleanupConfirmation({
      sessionId: session.sessionId,
      fingerprint,
      candidateIds: ['c1']
    })
    updateScanSessionCandidates(session.sessionId, [])
    await expect(executeConfirmedCleanup(preview.confirmationId)).rejects.toMatchObject({
      code: 'CONFIRMATION_NOT_FOUND'
    })
  })

  it('rejects reusing confirmation id', async () => {
    const size = (await measurePathDetailed(cacheDir, 32)).size
    const session = createScanSession('C:', 'combined', 'v1', [makeRuleCandidate('c1', cacheDir, size)])
    const fingerprint = buildSessionFingerprint(session.sessionId, session.createdAt, session.revision)
    const preview = prepareCleanupConfirmation({
      sessionId: session.sessionId,
      fingerprint,
      candidateIds: ['c1']
    })
    await executeConfirmedCleanup(preview.confirmationId)
    await expect(executeConfirmedCleanup(preview.confirmationId)).rejects.toMatchObject({
      code: 'CONFIRMATION_ALREADY_USED'
    })
  })
})

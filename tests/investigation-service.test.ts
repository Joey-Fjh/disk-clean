import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearScanSession, createScanSession, getScanSession, updateScanSessionCandidates } from '../src/main/scan/scan-session-store'
import {
  InvestigationRuntime,
  setInvestigationRuntimeForTests
} from '../src/main/agent/investigation/investigation-runtime'
import {
  InvestigationResultCache,
  setInvestigationResultCacheForTests
} from '../src/main/agent/investigation/investigation-cache'
import {
  cancelInvestigation,
  executeInvestigationTool,
  getInvestigationStatus,
  onNewScanSession,
  reuseInvestigationDataForModelSwitch,
  startInvestigation
} from '../src/main/agent/investigation/investigation-service'
import { normalizeCandidate } from '../src/shared/candidate-model'
import { hasLocalCleanupAuthorization } from '../src/shared/candidate-judgment'
import type { ScanItem } from '../src/shared/types'

function analyzerItem(path: string, id: string): ScanItem {
  return normalizeCandidate({
    id,
    ruleId: '__analyzer__',
    ruleName: 'Large Dir',
    category: 'dangerous',
    contentType: 'large-dir',
    drive: 'C:',
    path,
    size: 100,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    deletable: false,
    autoSelect: false,
    source: 'analyzer'
  })
}

function createFixture(): { root: string; sessionId: string; candidateRef: string } {
  const root = mkdtempSync(join(tmpdir(), 'disk-clean-investigation-'))
  mkdirSync(join(root, 'cache'))
  writeFileSync(join(root, 'cache', 'a.tmp'), 'hello')
  writeFileSync(join(root, 'cache', 'b.log'), 'world')
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, 'nested', 'c.bin'), '12345')

  const itemA = analyzerItem(root, 'item-a')
  const session = createScanSession('C:', 'full', 'test-rules', [itemA])
  onNewScanSession(`${session.sessionId}:${session.createdAt}:${session.revision}`)
  return { root, sessionId: session.sessionId, candidateRef: 'candidate-1' }
}

describe('investigation service', () => {
  let fixture: ReturnType<typeof createFixture> | null = null

  beforeEach(() => {
    setInvestigationRuntimeForTests(new InvestigationRuntime())
    setInvestigationResultCacheForTests(new InvestigationResultCache())
  })

  afterEach(() => {
    if (fixture) {
      rmSync(fixture.root, { recursive: true, force: true })
      fixture = null
    }
    clearScanSession()
  })

  it('lists children for a valid candidateRef', async () => {
    fixture = createFixture()
    startInvestigation(fixture.sessionId)
    const result = await executeInvestigationTool({
      sessionId: fixture.sessionId,
      candidateRef: fixture.candidateRef,
      toolName: 'list_children',
      relativePath: 'cache'
    })
    expect(result.result?.tool).toBe('list_children')
    expect(result.result && 'entries' in result.result ? result.result.entries.length : 0).toBeGreaterThan(0)
    expect(result.status.phase).toBe('analyzing')
  })

  it('rejects absolute paths from tool requests', async () => {
    fixture = createFixture()
    await expect(
      executeInvestigationTool({
        sessionId: fixture.sessionId,
        candidateRef: fixture.candidateRef,
        toolName: 'list_children',
        relativePath: 'C:\\Windows'
      })
    ).rejects.toMatchObject({ code: 'INVALID_RELATIVE_PATH' })
  })

  it('rejects traversal paths', async () => {
    fixture = createFixture()
    await expect(
      executeInvestigationTool({
        sessionId: fixture.sessionId,
        candidateRef: fixture.candidateRef,
        toolName: 'list_children',
        relativePath: '../outside'
      })
    ).rejects.toMatchObject({ code: 'INVALID_RELATIVE_PATH' })
  })

  it('rejects cross-candidate refs', async () => {
    fixture = createFixture()
    const session = createScanSession('C:', 'full', 'test-rules', [
      analyzerItem(join(fixture.root, 'nested'), 'item-b')
    ])
    onNewScanSession(`${session.sessionId}:${session.createdAt}:${session.revision}`)
    startInvestigation(session.sessionId)
    await expect(
      executeInvestigationTool({
        sessionId: session.sessionId,
        candidateRef: 'candidate-99',
        toolName: 'list_children'
      })
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' })
  })

  it('caches tool results by fingerprint and reuses on repeat', async () => {
    fixture = createFixture()
    startInvestigation(fixture.sessionId)
    const first = await executeInvestigationTool({
      sessionId: fixture.sessionId,
      candidateRef: fixture.candidateRef,
      toolName: 'sample_entry_names'
    })
    const second = await executeInvestigationTool({
      sessionId: fixture.sessionId,
      candidateRef: fixture.candidateRef,
      toolName: 'sample_entry_names'
    })
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
  })

  it('marks investigation cancelled and persists terminal status', () => {
    fixture = createFixture()
    startInvestigation(fixture.sessionId)
    const status = cancelInvestigation(fixture.sessionId)
    expect(status?.phase).toBe('cancelled')
    expect(getInvestigationStatus(fixture.sessionId)?.phase).toBe('cancelled')
  })

  it('rejects execute without active investigation', async () => {
    fixture = createFixture()
    await expect(
      executeInvestigationTool({
        sessionId: fixture.sessionId,
        candidateRef: fixture.candidateRef,
        toolName: 'list_children'
      })
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_ACTIVE' })
  })

  it('rejects execute after cancel', async () => {
    fixture = createFixture()
    startInvestigation(fixture.sessionId)
    cancelInvestigation(fixture.sessionId)
    await expect(
      executeInvestigationTool({
        sessionId: fixture.sessionId,
        candidateRef: fixture.candidateRef,
        toolName: 'list_children'
      })
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_ACTIVE' })
  })

  it('reuses investigation data but records a new conclusion model', () => {
    fixture = createFixture()
    startInvestigation(fixture.sessionId, 'model-a')
    const status = reuseInvestigationDataForModelSwitch(fixture.sessionId, 'model-b')
    expect(status.modelId).toBe('model-a')
    expect(status.conclusionModelId).toBe('model-b')
  })

  it('does not expand cleanup authorization through investigation', async () => {
    fixture = createFixture()
    startInvestigation(fixture.sessionId)
    const session = getScanSession(fixture.sessionId)!
    const before = [...session.candidates.values()][0]
    expect(hasLocalCleanupAuthorization(before)).toBe(false)
    await executeInvestigationTool({
      sessionId: fixture.sessionId,
      candidateRef: fixture.candidateRef,
      toolName: 'summarize_directory'
    })
    const after = getInvestigationStatus(fixture.sessionId)
    expect(after?.phase).toBe('analyzing')
    const item = [...session.candidates.values()][0]
    expect(hasLocalCleanupAuthorization(item)).toBe(false)
    expect(item.selection.selectable).toBe(false)
  })

  it('invalidates investigation after session revision changes', async () => {
    fixture = createFixture()
    const session = getScanSession(fixture.sessionId)!
    startInvestigation(fixture.sessionId)
    updateScanSessionCandidates(fixture.sessionId, [...session.candidates.values()])
    await expect(
      executeInvestigationTool({
        sessionId: fixture.sessionId,
        candidateRef: fixture.candidateRef,
        toolName: 'list_children'
      })
    ).rejects.toMatchObject({ code: 'SESSION_STALE' })
  })
})

describe('investigation symlink blocking', () => {
  beforeEach(() => {
    setInvestigationRuntimeForTests(new InvestigationRuntime())
    setInvestigationResultCacheForTests(new InvestigationResultCache())
  })

  afterEach(() => {
    clearScanSession()
  })

  it('blocks symlink targets outside candidate root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-investigation-link-'))
    const outside = mkdtempSync(join(tmpdir(), 'disk-clean-investigation-out-'))
    const linkPath = join(root, 'escape')
    try {
      symlinkSync(outside, linkPath, 'junction')
      const session = createScanSession('C:', 'full', 'test-rules', [analyzerItem(root, 'item-a')])
      onNewScanSession(`${session.sessionId}:${session.createdAt}:${session.revision}`)
      startInvestigation(session.sessionId)
      await expect(
        executeInvestigationTool({
          sessionId: session.sessionId,
          candidateRef: 'candidate-1',
          toolName: 'list_children',
          relativePath: 'escape'
        })
      ).rejects.toMatchObject({
        code: expect.stringMatching(/PATH_OUTSIDE_CANDIDATE|REPARSE_POINT_BLOCKED/)
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

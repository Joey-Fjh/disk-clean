import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throwIfAborted } from '../src/main/agent/investigation/investigation-abort'
import type { InvestigationAbortReason } from '../src/main/agent/investigation/investigation-abort'

const { listChildrenToolMock } = vi.hoisted(() => ({
  listChildrenToolMock: vi.fn()
}))

vi.mock('../src/main/agent/investigation/tools/list-children', () => ({
  listChildrenTool: listChildrenToolMock
}))

import { clearScanSession, createScanSession } from '../src/main/scan/scan-session-store'
import {
  InvestigationRuntime,
  getInvestigationRuntime,
  setInvestigationRuntimeForTests
} from '../src/main/agent/investigation/investigation-runtime'
import {
  InvestigationResultCache,
  setInvestigationResultCacheForTests
} from '../src/main/agent/investigation/investigation-cache'
import {
  advanceInvestigationRound,
  cancelInvestigation,
  completeInvestigation,
  executeInvestigationTool,
  getInvestigationStatus,
  onNewScanSession,
  startInvestigation
} from '../src/main/agent/investigation/investigation-service'
import { INVESTIGATION_LIMITS } from '../src/shared/investigation-limits'
import { normalizeCandidate } from '../src/shared/candidate-model'

function hangUntilAbort(
  signal: AbortSignal | undefined,
  resolveAbortReason: () => InvestigationAbortReason | null
): Promise<never> {
  if (!signal) {
    return Promise.reject(new Error('missing abort signal'))
  }
  if (signal.aborted) {
    throwIfAborted(signal, resolveAbortReason)
  }
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        try {
          throwIfAborted(signal, resolveAbortReason)
        } catch (error) {
          reject(error)
        }
      },
      { once: true }
    )
  })
}

function analyzerItem(path: string, id: string) {
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

describe('investigation lifecycle and budget', () => {
  let root = ''
  let sessionId = ''

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('../src/main/agent/investigation/tools/list-children')>(
      '../src/main/agent/investigation/tools/list-children'
    )
    listChildrenToolMock.mockReset()
    listChildrenToolMock.mockImplementation(actual.listChildrenTool)
    setInvestigationRuntimeForTests(new InvestigationRuntime())
    setInvestigationResultCacheForTests(new InvestigationResultCache())
    root = mkdtempSync(join(tmpdir(), 'disk-clean-investigation-life-'))
    mkdirSync(join(root, 'cache'))
    writeFileSync(join(root, 'cache', 'a.tmp'), 'x')
    const session = createScanSession('C:', 'full', 'test', [analyzerItem(root, 'a')])
    sessionId = session.sessionId
    onNewScanSession(`${session.sessionId}:${session.createdAt}:${session.revision}`)
  })

  afterEach(() => {
    clearScanSession()
    if (root) rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('rejects duplicate start without resetting budget', () => {
    const first = startInvestigation(sessionId)
    expect(() => startInvestigation(sessionId)).toThrow(/调查正在进行中/)
    expect(getInvestigationStatus(sessionId)?.budget.totalToolCalls).toBe(first.budget.totalToolCalls)
  })

  it('counts cached tool calls toward budget', async () => {
    startInvestigation(sessionId)
    const request = {
      sessionId,
      candidateRef: 'candidate-1',
      toolName: 'sample_entry_names' as const
    }
    const first = await executeInvestigationTool(request)
    const second = await executeInvestigationTool(request)
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(getInvestigationStatus(sessionId)?.budget.totalToolCalls).toBe(2)
  })

  it('rejects execute after complete', async () => {
    startInvestigation(sessionId)
    completeInvestigation(sessionId)
    await expect(
      executeInvestigationTool({
        sessionId,
        candidateRef: 'candidate-1',
        toolName: 'list_children'
      })
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_ACTIVE' })
    expect(getInvestigationStatus(sessionId)?.phase).toBe('completed')
  })

  it('enforces total tool call limit including cache hits', async () => {
    startInvestigation(sessionId)
    const request = {
      sessionId,
      candidateRef: 'candidate-1',
      toolName: 'sample_entry_names' as const
    }
    for (let i = 0; i < INVESTIGATION_LIMITS.MAX_TOTAL_TOOL_CALLS; i += 1) {
      const run = getInvestigationRuntime().getActiveRun()
      if (run && run.budget.toolCallsThisRound >= INVESTIGATION_LIMITS.MAX_TOOL_CALLS_PER_ROUND) {
        advanceInvestigationRound(sessionId)
      }
      await executeInvestigationTool(request)
    }
    await expect(executeInvestigationTool(request)).rejects.toMatchObject({ code: 'TOOL_LIMIT_EXCEEDED' })
    expect(getInvestigationStatus(sessionId)?.phase).toBe('uncertain')
    await expect(executeInvestigationTool(request)).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_ACTIVE' })
    expect(startInvestigation(sessionId).phase).toBe('analyzing')
  })

  it('returns TIMEOUT on tool timeout', async () => {
    const originalSetTimeout = global.setTimeout.bind(global)
    vi.spyOn(global, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
      const delay = timeout === INVESTIGATION_LIMITS.TOOL_TIMEOUT_MS ? 30 : timeout
      return originalSetTimeout(handler as TimerHandler, delay ?? 0, ...(args as []))
    })
    listChildrenToolMock.mockImplementation(
      async (_resolved, _limit, signal, resolveAbortReason) => hangUntilAbort(signal, resolveAbortReason)
    )
    startInvestigation(sessionId)
    const pending = executeInvestigationTool({
      sessionId,
      candidateRef: 'candidate-1',
      toolName: 'list_children'
    })
    await vi.waitFor(() => listChildrenToolMock.mock.calls.length > 0, { timeout: 2000 })
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('returns CANCELLED on user cancel', async () => {
    listChildrenToolMock.mockImplementation(
      async (_resolved, _limit, signal, resolveAbortReason) => hangUntilAbort(signal, resolveAbortReason)
    )
    startInvestigation(sessionId)
    const pending = executeInvestigationTool({
      sessionId,
      candidateRef: 'candidate-1',
      toolName: 'list_children'
    })
    await vi.waitFor(() => listChildrenToolMock.mock.calls.length > 0, { timeout: 2000 })
    cancelInvestigation(sessionId)
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(getInvestigationStatus(sessionId)?.phase).toBe('cancelled')
  })

  it('enforces per-round tool call limit without leaving tool_running', async () => {
    startInvestigation(sessionId)
    for (let i = 0; i < INVESTIGATION_LIMITS.MAX_TOOL_CALLS_PER_ROUND; i += 1) {
      await executeInvestigationTool({
        sessionId,
        candidateRef: 'candidate-1',
        toolName: 'list_children',
        limit: i + 1
      })
    }
    await expect(
      executeInvestigationTool({
        sessionId,
        candidateRef: 'candidate-1',
        toolName: 'list_children'
      })
    ).rejects.toMatchObject({ code: 'TOOL_LIMIT_EXCEEDED' })
    const status = getInvestigationStatus(sessionId)
    expect(status?.phase).toBe('uncertain')
    expect(status?.lastErrorCode).toBe('TOOL_LIMIT_EXCEEDED')
    expect(status?.phase).not.toBe('tool_running')
    await expect(
      executeInvestigationTool({
        sessionId,
        candidateRef: 'candidate-1',
        toolName: 'list_children'
      })
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_ACTIVE' })
  })

  it('advances rounds through the service API and stops at MAX_ROUNDS', () => {
    startInvestigation(sessionId)
    for (let round = 1; round < INVESTIGATION_LIMITS.MAX_ROUNDS; round += 1) {
      advanceInvestigationRound(sessionId)
    }
    const status = advanceInvestigationRound(sessionId)
    expect(status.phase).toBe('uncertain')
    expect(status.lastErrorCode).toBe('TOOL_LIMIT_EXCEEDED')
  })

  it('rolls back tool_running without leaving a zombie phase', () => {
    startInvestigation(sessionId)
    const runtime = getInvestigationRuntime()
    const run = runtime.getActiveRun()!
    runtime.transition(run.requestId, 'request_tool')
    runtime.transition(run.requestId, 'run_tool')
    runtime.rollbackToolPhase(run.requestId)
    expect(getInvestigationStatus(sessionId)?.phase).toBe('analyzing')
    expect(getInvestigationStatus(sessionId)?.phase).not.toBe('tool_running')
  })

  it('rejects tool-specific parameters at service layer', async () => {
    startInvestigation(sessionId)
    await expect(
      executeInvestigationTool({
        sessionId,
        candidateRef: 'candidate-1',
        toolName: 'list_children',
        depth: 1
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      executeInvestigationTool({
        sessionId,
        candidateRef: 'candidate-1',
        toolName: 'summarize_directory',
        limit: 5
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('fires investigation total timeout', () => {
    vi.useFakeTimers()
    const runtime = new InvestigationRuntime()
    const session = createScanSession('C:', 'full', 'test', [analyzerItem(root, 'a')])
    const fingerprint = `${session.sessionId}:${session.createdAt}:${session.revision}`
    runtime.start(session.sessionId, fingerprint)
    vi.advanceTimersByTime(INVESTIGATION_LIMITS.INVESTIGATION_TIMEOUT_MS + 1)
    const status = runtime.resolveStatus(session.sessionId, fingerprint)
    expect(status.phase).toBe('failed')
    expect(status.lastErrorCode).toBe('TIMEOUT')
    vi.useRealTimers()
  })

  it('truncates summarize_directory traversal before scanning entire tree', async () => {
    for (let i = 0; i < INVESTIGATION_LIMITS.MAX_TRAVERSED_ENTRIES + 20; i += 1) {
      writeFileSync(join(root, `entry-${i}.tmp`), 'x')
    }
    startInvestigation(sessionId)
    const result = await executeInvestigationTool({
      sessionId,
      candidateRef: 'candidate-1',
      toolName: 'summarize_directory',
      depth: 0
    })
    expect(result.result.summary.truncated).toBe(true)
    expect(result.result.summary.fileCount).toBeLessThan(INVESTIGATION_LIMITS.MAX_TRAVERSED_ENTRIES + 20)
  })
})

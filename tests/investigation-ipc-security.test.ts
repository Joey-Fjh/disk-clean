import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  handleInvestigationExecuteTool,
  handleInvestigationStart,
  handleInvestigationStatus
} from '../src/main/agent/investigation/investigation-ipc'
import {
  InvestigationRuntime,
  setInvestigationRuntimeForTests
} from '../src/main/agent/investigation/investigation-runtime'
import {
  InvestigationResultCache,
  setInvestigationResultCacheForTests
} from '../src/main/agent/investigation/investigation-cache'
import { onNewScanSession } from '../src/main/agent/investigation/investigation-service'
import { clearScanSession, createScanSession } from '../src/main/scan/scan-session-store'
import { setTrustedSenderCheckerForTests } from '../src/main/window-security'
import { normalizeCandidate } from '../src/shared/candidate-model'

beforeEach(() => {
  setInvestigationRuntimeForTests(new InvestigationRuntime())
  setInvestigationResultCacheForTests(new InvestigationResultCache())
})

afterEach(() => {
  clearScanSession()
  setTrustedSenderCheckerForTests(undefined)
})

describe('investigation ipc security', () => {
  it('rejects untrusted senders', async () => {
    setTrustedSenderCheckerForTests(() => false)
    const result = await handleInvestigationStatus({} as never, { sessionId: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('IPC_UNAUTHORIZED')
  })

  it('does not accept absolute paths in tool IPC payload', async () => {
    setTrustedSenderCheckerForTests(() => true)
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-investigation-ipc-'))
    const item = normalizeCandidate({
      id: 'a',
      ruleId: '__analyzer__',
      ruleName: 'Large Dir',
      category: 'dangerous',
      contentType: 'large-dir',
      drive: 'C:',
      path: root,
      size: 1,
      sizeIsEstimate: true,
      snapshotComplete: true,
      entryKind: 'directory',
      deletable: false,
      autoSelect: false,
      source: 'analyzer'
    })
    const session = createScanSession('C:', 'full', 'test', [item])
    await expect(
      handleInvestigationExecuteTool({} as never, {
        sessionId: session.sessionId,
        candidateRef: 'candidate-1',
        toolName: 'list_children',
        relativePath: 'C:\\secret'
      })
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_RELATIVE_PATH' })
  })

  it('rejects NaN limit values at IPC boundary', async () => {
    setTrustedSenderCheckerForTests(() => true)
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-investigation-ipc-nan-'))
    const item = normalizeCandidate({
      id: 'a',
      ruleId: '__analyzer__',
      ruleName: 'Large Dir',
      category: 'dangerous',
      contentType: 'large-dir',
      drive: 'C:',
      path: root,
      size: 1,
      sizeIsEstimate: true,
      snapshotComplete: true,
      entryKind: 'directory',
      deletable: false,
      autoSelect: false,
      source: 'analyzer'
    })
    const session = createScanSession('C:', 'full', 'test', [item])
    onNewScanSession(`${session.sessionId}:${session.createdAt}:${session.revision}`)
    await handleInvestigationStart({} as never, { sessionId: session.sessionId })
    await expect(
      handleInvestigationExecuteTool({} as never, {
        sessionId: session.sessionId,
        candidateRef: 'candidate-1',
        toolName: 'list_children',
        limit: Number.NaN
      })
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })
})

describe('investigation preload contract', () => {
  it('does not expose arbitrary path fields in investigation request types', () => {
    const { readFileSync } = require('fs')
    const { join } = require('path')
    const source = ['src/shared/investigation-types.ts', 'src/main/agent/investigation/investigation-ipc.ts']
      .map((file) => readFileSync(join(process.cwd(), file), 'utf-8'))
      .join('\n')
    expect(source).toContain('relativePath')
    expect(source).not.toMatch(/absolutePath/)
    expect(source).not.toMatch(/targetPath:\s*string/)
  })
})

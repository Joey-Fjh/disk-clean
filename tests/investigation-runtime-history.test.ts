import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { InvestigationRuntime } from '../src/main/agent/investigation/investigation-runtime'
import { INVESTIGATION_LIMITS } from '../src/shared/investigation-limits'
import { normalizeCandidate } from '../src/shared/candidate-model'
import { createScanSession } from '../src/main/scan/scan-session-store'

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

describe('investigation runtime history limits', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('prunes terminal history beyond the configured limit', () => {
    const runtime = new InvestigationRuntime()
    root = mkdtempSync(join(tmpdir(), 'disk-clean-runtime-history-'))
    mkdirSync(join(root, 'cache'))

    const sessions: Array<{ sessionId: string; fingerprint: string }> = []
    for (let i = 0; i < INVESTIGATION_LIMITS.MAX_TERMINAL_HISTORY_ENTRIES + 5; i += 1) {
      const session = createScanSession('C:', 'full', `test-${i}`, [analyzerItem(root, `a-${i}`)])
      const fingerprint = `${session.sessionId}:${session.createdAt}:${session.revision}`
      sessions.push({ sessionId: session.sessionId, fingerprint })
      runtime.start(session.sessionId, fingerprint)
      runtime.complete(runtime.getActiveRun()!.requestId, 'completed')
    }

    expect(runtime.getTerminalStatus(sessions[0].sessionId, sessions[0].fingerprint)).toBeNull()
    const last = sessions[sessions.length - 1]
    expect(runtime.getTerminalStatus(last.sessionId, last.fingerprint)?.phase).toBe('completed')
  })

  it('clears unrelated session history on new scan fingerprint', () => {
    const runtime = new InvestigationRuntime()
    root = mkdtempSync(join(tmpdir(), 'disk-clean-runtime-clear-'))
    const session = createScanSession('C:', 'full', 'test', [analyzerItem(root, 'a')])
    const fingerprintA = `${session.sessionId}:${session.createdAt}:${session.revision}`
    runtime.start(session.sessionId, fingerprintA)
    runtime.complete(runtime.getActiveRun()!.requestId, 'completed')

    const other = createScanSession('C:', 'full', 'other', [analyzerItem(root, 'b')])
    runtime.clearHistoryExcept(other.sessionId)
    expect(runtime.getTerminalStatus(session.sessionId, fingerprintA)).toBeNull()
  })
})

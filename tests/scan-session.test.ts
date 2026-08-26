import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createScanSession,
  getScanSession,
  SCAN_SESSION_TTL_MS,
  updateScanSessionCandidates
} from '../src/main/scan/scan-session-store'
import type { ScanCandidate } from '../src/shared/types'

function candidate(id: string): ScanCandidate {
  return {
    id,
    ruleId: 'r',
    ruleName: 'r',
    category: 'safe',
    contentType: 'system-temp',
    drive: 'C:',
    path: `C:\\temp\\${id}`,
    size: 1,
    sizeIsEstimate: false,
    snapshotComplete: true,
    entryKind: 'file',
    deletable: true,
    autoSelect: false,
    source: 'rule'
  }
}

describe('scan session TTL', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('expires after TTL', () => {
    vi.useFakeTimers()
    const session = createScanSession('C:', 'quick', 'v1', [candidate('a')])
    expect(getScanSession(session.sessionId)).not.toBeNull()

    vi.advanceTimersByTime(SCAN_SESSION_TTL_MS + 1)
    expect(getScanSession(session.sessionId)).toBeNull()
  })

  it('increments revision when candidates are updated', () => {
    const session = createScanSession('C:', 'quick', 'v1', [candidate('a')])
    expect(session.revision).toBe(0)
    updateScanSessionCandidates(session.sessionId, [candidate('b')])
    expect(getScanSession(session.sessionId)?.revision).toBe(1)
  })
})

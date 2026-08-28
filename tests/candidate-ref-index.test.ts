import { describe, expect, it } from 'vitest'
import { buildCandidateRefIndex } from '../src/shared/candidate-ref-index'
import { buildAgentInvestigationCandidates } from '../src/shared/agent-candidate-prep'
import { normalizeCandidate } from '../src/shared/candidate-model'
import type { ScanItem } from '../src/shared/types'
import { registerCandidateRefMap } from '../src/main/agent/investigation/candidate-ref'
import { createScanSession, clearScanSession } from '../src/main/scan/scan-session-store'
import { resolveCandidateByRef } from '../src/main/agent/investigation/candidate-ref'

function item(id: string, size: number, path: string): ScanItem {
  return normalizeCandidate({
    id,
    ruleId: 'rule-a',
    ruleName: 'Temp',
    category: 'safe',
    contentType: 'system-temp',
    drive: 'C:',
    path,
    size,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
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

describe('canonical candidateRef index', () => {
  it('keeps stable refs when investigation priority order differs', () => {
    const items = [
      item('small', 60 * 1024 * 1024, 'C:\\Temp\\small'),
      item('large', 900 * 1024 * 1024, 'C:\\Temp\\large')
    ]
    const refIndex = buildCandidateRefIndex(items, 'fp:test', 0)
    expect(refIndex.idToRef.get('small')).toBe('candidate-1')
    expect(refIndex.idToRef.get('large')).toBe('candidate-2')

    const ranked = buildAgentInvestigationCandidates(items, { refIndex, minBytes: 50 * 1024 * 1024 })
    expect(ranked[0]?.candidateId).toBe('large')
    expect(ranked[0]?.candidateRef).toBe('candidate-2')
    expect(ranked[1]?.candidateRef).toBe('candidate-1')
  })

  it('resolves tool candidateRef against registered canonical map', () => {
    const a = item('a', 100, 'C:\\Temp\\a')
    const b = item('b', 200, 'C:\\Temp\\b')
    const session = createScanSession('C:', 'full', 'v1', [a, b])
    const fingerprint = `${session.sessionId}:${session.createdAt}:${session.revision}`
    const refIndex = buildCandidateRefIndex([a, b], fingerprint, session.revision)
    registerCandidateRefMap(fingerprint, refIndex.refToId)

    const resolved = resolveCandidateByRef(session, 'candidate-2', fingerprint)
    expect(resolved.id).toBe('b')
    clearScanSession()
  })
})

import { describe, expect, it } from 'vitest'
import { buildAgentMessages } from '../src/main/agent/agent-prompt'
import { buildCandidateRefIndex } from '../src/shared/candidate-ref-index'
import { buildAgentInvestigationCandidates } from '../src/shared/agent-candidate-prep'
import { normalizeCandidate } from '../src/shared/candidate-model'
import type { ScanItem } from '../src/shared/types'

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

describe('agent prompt focus candidates', () => {
  it('sends priority investigation candidates instead of raw session order', () => {
    const items = [
      item('small', 60 * 1024 * 1024, 'C:\\Temp\\small'),
      item('large', 900 * 1024 * 1024, 'C:\\Temp\\large')
    ]
    const refIndex = buildCandidateRefIndex(items, 'fp:test', 0)
    const investigationCandidates = buildAgentInvestigationCandidates(items, { refIndex })

    const { build, messages } = buildAgentMessages(items, {
      refIndex: { refToId: refIndex.refToId, idToRef: refIndex.idToRef },
      investigationCandidates
    })

    expect(build.payload.candidateCount).toBe(investigationCandidates.length)
    expect(build.payload.investigationPriorityRefs).toContain('candidate-2')
    expect(build.payload.candidates[0]?.candidateRef).toBe('candidate-2')
    const userContent = messages[1]?.content ?? ''
    expect(userContent).toContain('candidate-2')
    expect(userContent).toContain('investigationPriorityRefs')
  })

  it('does not mutate canonical refToId when shrinking prompt', () => {
    const items = Array.from({ length: 3 }, (_, index) =>
      item(`id-${index}`, 1024, `C:\\Temp\\item-${index}`)
    )
    const refIndex = buildCandidateRefIndex(items, 'fp:shrink', 0)
    const canonicalSize = refIndex.refToId.size

    buildAgentMessages(items, {
      refIndex: { refToId: refIndex.refToId, idToRef: refIndex.idToRef },
      investigationCandidates: buildAgentInvestigationCandidates(items, { refIndex })
    })

    expect(refIndex.refToId.size).toBe(canonicalSize)
    expect(refIndex.refToId.get('candidate-1')).toBe('id-0')
    expect(refIndex.refToId.get('candidate-3')).toBe('id-2')
  })
})

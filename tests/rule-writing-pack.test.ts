import { describe, expect, it } from 'vitest'
import { buildRuleWritingPack, assertWritingPackSafe } from '../src/main/rules/rule-draft-writing-pack'
import { RULE_DRAFT_LIMITS } from '../src/shared/rule-draft-limits'
import type { ScanSession } from '../src/main/scan/scan-session-store'
import { mapSpaceScanItem } from '../src/shared/candidate-model'

describe('rule writing pack', () => {
  it('does not include raw absolute paths in exported pack', () => {
    const item = mapSpaceScanItem({
      id: 'candidate-1',
      ruleId: '__analyzer__',
      ruleName: 'cache',
      category: 'dangerous',
      contentType: 'app-cache',
      drive: 'C:',
      path: process.env.LOCALAPPDATA + '\\Vendor\\Cache\\file.bin',
      size: 100,
      sizeIsEstimate: true,
      snapshotComplete: true,
      entryKind: 'file',
      deletable: false,
      autoSelect: false,
      source: 'analyzer',
      discoverySources: ['space-scan'],
      evidence: [],
      judgment: { status: 'pending', source: 'none', confidence: 'unknown', basis: [] },
      selection: { selectable: false },
      suggestedAction: 'none'
    })

    const session: ScanSession = {
      sessionId: 'session-1',
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
      revision: 0,
      drive: 'C:',
      mode: 'combined',
      rulesVersion: 'v1',
      candidates: new Map([[item.id, item]])
    }

    const pack = buildRuleWritingPack(session, [item], ['candidate-1'])
    expect(() => assertWritingPackSafe(pack)).not.toThrow()
    const raw = JSON.stringify(pack)
    expect(raw).not.toContain(process.env.USERNAME ?? 'Administrator')
    expect(pack.forbiddenFields).toContain('deletable')
  })

  it('rejects more than max candidates instead of silently truncating', () => {
    const session: ScanSession = {
      sessionId: 'session-2',
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
      revision: 0,
      drive: 'C:',
      mode: 'combined',
      rulesVersion: 'v1',
      candidates: new Map()
    }

    const items = Array.from({ length: RULE_DRAFT_LIMITS.MAX_CANDIDATES_PER_REQUEST + 1 }, (_, index) =>
      mapSpaceScanItem({
        id: `candidate-${index}`,
        ruleId: '__analyzer__',
        ruleName: 'cache',
        category: 'dangerous',
        contentType: 'app-cache',
        drive: 'C:',
        path: `C:\\cache\\${index}`,
        size: 1,
        sizeIsEstimate: true,
        snapshotComplete: true,
        entryKind: 'file',
        deletable: false,
        autoSelect: false,
        source: 'analyzer',
        discoverySources: ['space-scan'],
        evidence: [],
        judgment: { status: 'pending', source: 'none', confidence: 'unknown', basis: [] },
        selection: { selectable: false },
        suggestedAction: 'none'
      })
    )

    expect(() => buildRuleWritingPack(session, items)).toThrow(/最多包含/)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { previewRuleDraftOnSession } from '../src/main/rules/rule-draft-preview'
import type { RuleDraftV1 } from '../src/shared/rule-layer-types'
import type { ScanSession } from '../src/main/scan/scan-session-store'
import { mapSpaceScanItem } from '../src/shared/candidate-model'
import * as ruleMatch from '../src/shared/rule-match'

const draft: RuleDraftV1 = {
  schemaVersion: '1',
  name: 'Cache draft',
  contentType: 'app-cache',
  basePlaceholders: ['%TEMP%'],
  subdirs: ['vendor-cache'],
  reason: 'cache',
  suggestedRisk: 'recommended',
  source: 'agent-generated',
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('previewRuleDraftOnSession', () => {
  it('uses collectRuleTargets for matching', async () => {
    const targetPath = (process.env.TEMP ?? 'C:\\Windows\\Temp') + '\\vendor-cache'
    const collectSpy = vi.spyOn(ruleMatch, 'collectRuleTargets').mockResolvedValue([targetPath])

    const item = mapSpaceScanItem({
      id: 'candidate-1',
      ruleId: '__analyzer__',
      ruleName: 'cache',
      category: 'dangerous',
      contentType: 'app-cache',
      drive: 'C:',
      path: targetPath,
      size: 2048,
      sizeIsEstimate: true,
      snapshotComplete: true,
      entryKind: 'directory',
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
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      revision: 0,
      drive: 'C:',
      mode: 'combined',
      rulesVersion: 'v1',
      candidates: new Map([[item.id, item]])
    }

    const preview = await previewRuleDraftOnSession(draft, session, 'draft-1')
    expect(collectSpy).toHaveBeenCalled()
    expect(preview.matchCount).toBeGreaterThanOrEqual(1)
    collectSpy.mockRestore()
  })
})

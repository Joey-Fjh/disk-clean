import { describe, expect, it, vi } from 'vitest'
import { compileRuleDraftToRuleConfig } from '../src/main/rules/rule-draft-compiler'
import {
  canApproveRuleDraftPreview,
  previewRuleDraftOnSession,
  sessionFingerprint
} from '../src/main/rules/rule-draft-preview'
import {
  RuleDraftValidationError,
  validateRuleDraftInput
} from '../src/main/rules/rule-draft-validator'
import type { RuleDraftV1 } from '../src/shared/rule-layer-types'
import type { ScanSession } from '../src/main/scan/scan-session-store'
import { mapSpaceScanItem } from '../src/shared/candidate-model'
import * as ruleMatch from '../src/shared/rule-match'
import { updateScanSessionCandidates, createScanSession, getScanSession } from '../src/main/scan/scan-session-store'

const localAppDataDraft: RuleDraftV1 = {
  schemaVersion: '1',
  name: 'Cursor cache',
  contentType: 'app-cache',
  basePlaceholders: ['%LOCALAPPDATA%'],
  subdirs: ['Vendor/Cache'],
  reason: 'Vendor cache directory',
  suggestedRisk: 'recommended',
  rebuildable: true,
  source: 'user-import',
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('rule draft safety', () => {
  it('rejects unanchored glob patterns at validation', () => {
    expect(() =>
      validateRuleDraftInput({
        ...localAppDataDraft,
        subdirs: undefined,
        globDirs: ['**/*']
      })
    ).toThrow(RuleDraftValidationError)
  })

  it('only allows deletable when rebuildable is explicitly true', () => {
    const evidenceOnly = compileRuleDraftToRuleConfig(
      { ...localAppDataDraft, rebuildable: undefined },
      'draft-1'
    )
    expect(evidenceOnly.deletable).toBe(false)

    const deletable = compileRuleDraftToRuleConfig(
      { ...localAppDataDraft, rebuildable: true },
      'draft-2'
    )
    expect(deletable.deletable).toBe(true)
  })

  it('compiles %LOCALAPPDATA% with specific subdirs end-to-end', async () => {
    const validated = validateRuleDraftInput(localAppDataDraft)
    const rule = compileRuleDraftToRuleConfig(validated, 'cursor')
    expect(rule.subdirs).toEqual(['Vendor/Cache'])

    const targetPath = (process.env.LOCALAPPDATA ?? 'C:\\Users\\AppData\\Local') + '\\Vendor\\Cache'
    vi.spyOn(ruleMatch, 'collectRuleTargets').mockResolvedValue([targetPath])

    const item = mapSpaceScanItem({
      id: 'candidate-1',
      ruleId: '__analyzer__',
      ruleName: 'cache',
      category: 'dangerous',
      contentType: 'app-cache',
      drive: 'C:',
      path: targetPath + '\\file.bin',
      size: 1024,
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
      createdAt: 100,
      expiresAt: Date.now() + 60_000,
      revision: 0,
      drive: 'C:',
      mode: 'combined',
      rulesVersion: 'v1',
      candidates: new Map([[item.id, item]])
    }

    const preview = await previewRuleDraftOnSession(validated, session, 'cursor')
    expect(preview.matchCount).toBeGreaterThanOrEqual(1)
    expect(preview.approvable).toBe(true)
    expect(preview.scope.basePlaceholders).toEqual(['%LOCALAPPDATA%'])
    vi.restoreAllMocks()
  })

  it('blocks approval for overly broad ProgramData glob draft', async () => {
    const validated = validateRuleDraftInput({
      schemaVersion: '1',
      name: 'Broad',
      contentType: 'app-cache',
      basePlaceholders: ['%ProgramData%'],
      globDirs: ['Microsoft/Cache/*'],
      reason: 'too broad',
      suggestedRisk: 'recommended',
      source: 'user-import',
      createdAt: '2026-01-01T00:00:00.000Z'
    })

    const collectSpy = vi.spyOn(ruleMatch, 'collectRuleTargets').mockResolvedValue(
      Array.from({ length: 60 }, (_, index) => `C:\\ProgramData\\target-${index}`)
    )

    const session: ScanSession = {
      sessionId: 'session-2',
      createdAt: 200,
      expiresAt: Date.now() + 60_000,
      revision: 0,
      drive: 'C:',
      mode: 'combined',
      rulesVersion: 'v1',
      candidates: new Map()
    }

    const preview = await previewRuleDraftOnSession(validated, session, 'broad')
    expect(preview.approvable).toBe(false)
    expect(preview.blockReason).toMatch(/目标数量过多/)
    collectSpy.mockRestore()
  })

  it('rejects subdirs plus globDirs combination at validation', () => {
    expect(() =>
      validateRuleDraftInput({
        ...localAppDataDraft,
        globDirs: ['Vendor/Cache']
      })
    ).toThrow(/只能三选一/)
  })

  it('invalidates preview when session revision changes', () => {
    const session = createScanSession('C:', 'combined', 'v1', [])

    const preview = {
      sessionId: session.sessionId,
      sessionFingerprint: sessionFingerprint(session),
      matchCount: 1,
      ruleTargetCount: 1,
      estimatedBytes: 100,
      excludedProtectedCount: 0,
      protectedTargetCount: 0,
      drives: ['C:'],
      samples: [],
      warnings: [],
      approvable: true,
      scope: {
        basePlaceholders: ['%TEMP%'],
        subdirs: ['cache'],
        suggestedRisk: 'safe',
        reason: 'cache'
      },
      previewedAt: '2026-01-01T00:00:00.000Z'
    }

    expect(canApproveRuleDraftPreview(preview, session).ok).toBe(true)

    updateScanSessionCandidates(session.sessionId, [])
    const updated = getScanSession(session.sessionId)
    expect(updated).not.toBeNull()
    expect(canApproveRuleDraftPreview(preview, updated).ok).toBe(false)
  })
})

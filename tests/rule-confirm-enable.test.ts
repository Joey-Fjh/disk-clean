import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredRuleDraft } from '../src/shared/rule-layer-types'
import type { ScanSession } from '../src/main/scan/scan-session-store'
import { sessionFingerprint } from '../src/main/rules/rule-draft-preview'

const getRuleDraft = vi.fn<() => StoredRuleDraft | null>()
const updateRuleDraftStatus = vi.fn()
const { getScanSession } = vi.hoisted(() => ({
  getScanSession: vi.fn<() => ScanSession | null>()
}))

vi.mock('../src/main/rules/rule-draft-store', () => ({
  getRuleDraft: () => getRuleDraft(),
  updateRuleDraftStatus: (...args: unknown[]) => updateRuleDraftStatus(...args)
}))

vi.mock('../src/main/scan/scan-session-store', () => ({
  getScanSession: () => getScanSession()
}))

import { confirmAndEnableRuleDraft } from '../src/main/rules/rule-layer-service'

const session: ScanSession = {
  sessionId: 'session-1',
  createdAt: 100,
  expiresAt: Date.now() + 60_000,
  revision: 0,
  drive: 'C:',
  mode: 'combined',
  rulesVersion: 'v1',
  candidates: new Map()
}

const preview = {
  sessionId: 'session-1',
  sessionFingerprint: sessionFingerprint(session),
  matchCount: 2,
  ruleTargetCount: 2,
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
    suggestedRisk: 'safe' as const,
    reason: 'cache'
  },
  previewedAt: '2026-01-01T00:00:00.000Z'
}

const baseDraft: StoredRuleDraft = {
  id: 'draft-1',
  status: 'draft',
  origin: 'user-import',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  sessionFingerprint: sessionFingerprint(session),
  draft: {
    schemaVersion: '1',
    name: 'Cache draft',
    contentType: 'app-cache',
    basePlaceholders: ['%TEMP%'],
    subdirs: ['cache'],
    reason: 'cache',
    suggestedRisk: 'safe',
    source: 'user-import',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  preview
}

describe('confirmAndEnableRuleDraft', () => {
  beforeEach(() => {
    getRuleDraft.mockReset()
    updateRuleDraftStatus.mockReset()
    getScanSession.mockReset()
    getScanSession.mockReturnValue(session)
  })

  it('rejects stale preview when session revision changed', () => {
    getRuleDraft.mockReturnValue(baseDraft)
    getScanSession.mockReturnValue({ ...session, revision: 1 })

    const result = confirmAndEnableRuleDraft('draft-1')
    expect(result.ok).toBe(false)
    expect(result.code).toBe('STALE_PREVIEW')
    expect(updateRuleDraftStatus).not.toHaveBeenCalled()
  })

  it('persists enabled state in a single write when preview is valid', () => {
    getRuleDraft.mockReturnValue(baseDraft)
    updateRuleDraftStatus.mockReturnValue({
      ...baseDraft,
      status: 'enabled',
      compiledRuleId: 'draft:draft-1',
      approvedAt: '2026-01-01T00:00:00.000Z'
    })

    const result = confirmAndEnableRuleDraft('draft-1')
    expect(result.ok).toBe(true)
    expect(result.code).toBe('ENABLED_NEEDS_RESCAN')
    expect(updateRuleDraftStatus).toHaveBeenCalledTimes(1)
    expect(updateRuleDraftStatus).toHaveBeenCalledWith('draft-1', 'enabled', {
      compiledRuleId: 'draft:draft-1',
      sessionFingerprint: sessionFingerprint(session),
      approvedAt: expect.any(String)
    })
  })

  it('returns failure when single persistence write fails', () => {
    getRuleDraft.mockReturnValue(baseDraft)
    updateRuleDraftStatus.mockReturnValue(null)

    const result = confirmAndEnableRuleDraft('draft-1')
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ENABLE_FAILED')
    expect(updateRuleDraftStatus).toHaveBeenCalledTimes(1)
  })

  it('rejects non-approvable preview', () => {
    getRuleDraft.mockReturnValue({
      ...baseDraft,
      preview: { ...preview, approvable: false, blockReason: '范围过宽' }
    })

    const result = confirmAndEnableRuleDraft('draft-1')
    expect(result.ok).toBe(false)
    expect(result.code).toBe('PREVIEW_NOT_APPROVABLE')
  })
})

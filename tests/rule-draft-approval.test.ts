import { describe, expect, it } from 'vitest'
import { canApproveRuleDraftPreview } from '../src/main/rules/rule-draft-preview'
import type { ScanSession } from '../src/main/scan/scan-session-store'

const preview = {
  sessionId: 'session-1',
  sessionFingerprint: 'session-1:100:0',
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
    suggestedRisk: 'safe',
    reason: 'cache'
  },
  previewedAt: '2026-01-01T00:00:00.000Z'
}

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

describe('canApproveRuleDraftPreview', () => {
  it('rejects when live session fingerprint changed', () => {
    const result = canApproveRuleDraftPreview(preview, {
      ...session,
      revision: 1
    })
    expect(result.ok).toBe(false)
  })

  it('rejects when session is missing', () => {
    expect(canApproveRuleDraftPreview(preview, null).ok).toBe(false)
  })

  it('rejects non-approvable preview even when fingerprint matches', () => {
    const blocked = { ...preview, approvable: false, blockReason: '范围过宽' }
    expect(canApproveRuleDraftPreview(blocked, session).ok).toBe(false)
  })

  it('accepts matching live session when approvable', () => {
    expect(canApproveRuleDraftPreview(preview, session).ok).toBe(true)
  })
})

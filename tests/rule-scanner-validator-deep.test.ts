import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRuleScan } from '../src/main/scanner/rule-scanner'
import { validateCleanupActions } from '../src/main/cleanup/safety-validator'
import { createScanSession } from '../src/main/scan/scan-session-store'
import type { RuleWithMeta, ScanCandidate } from '../src/shared/types'

vi.mock('../src/main/rules', () => ({
  getActiveRulesWithMeta: vi.fn(),
  getAllRulesWithMeta: vi.fn(),
  getProtectedPaths: () => [],
  getPathAccessPolicy: () => ({
    denyRead: [],
    readOnlyHighRisk: [],
    denyDelete: []
  })
}))

import { getActiveRulesWithMeta, getAllRulesWithMeta } from '../src/main/rules'

describe('deep temp file cleanup authorization', () => {
  let root = ''

  afterEach(() => {
    if (root) {
      require('fs').rmSync(root, { recursive: true, force: true })
      root = ''
    }
  })

  it('approves nested aged temp files through validator using rule root anchor', async () => {
    root = mkdtempSync(join(tmpdir(), 'disk-clean-deep-'))
    const oldFolder = join(root, 'old-folder')
    const nested = join(oldFolder, 'nested')
    mkdirSync(nested, { recursive: true })
    const oldFile = join(nested, 'old.log')
    const recentFile = join(nested, 'new.log')
    writeFileSync(oldFile, 'old')
    writeFileSync(recentFile, 'new')
    const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const recentTime = new Date()
    utimesSync(oldFolder, oldTime, oldTime)
    utimesSync(nested, oldTime, oldTime)
    utimesSync(oldFile, oldTime, oldTime)
    utimesSync(recentFile, recentTime, recentTime)

    const rule: RuleWithMeta = {
      id: 'user-temp',
      name: 'Temp',
      category: 'safe',
      contentType: 'system-temp',
      paths: [root],
      maxAgeDays: 7,
      defaultChecked: true,
      enabled: true,
      source: 'builtin',
      cleanupMethod: 'trash'
    }
    vi.mocked(getActiveRulesWithMeta).mockReturnValue([rule])
    vi.mocked(getAllRulesWithMeta).mockReturnValue([rule])

    const scan = await runRuleScan('all')
    const deep = scan.items.find((item) => item.path === oldFile)
    const recent = scan.items.find((item) => item.path === recentFile)
    expect(deep).toBeDefined()
    expect(deep?.parentTarget).toBe(root)
    expect(recent).toBeUndefined()

    const candidate = deep! as ScanCandidate
    const session = createScanSession('C:', 'quick', 'deep-v1', [candidate])
    const result = await validateCleanupActions(session.sessionId, [
      {
        candidateId: candidate.id,
        ruleId: 'user-temp',
        target: oldFile,
        operation: 'trash',
        estimatedLogicalBytes: candidate.size
      }
    ])
    expect(result.rejected).toEqual([])
    expect(result.approved).toHaveLength(1)
  })
})

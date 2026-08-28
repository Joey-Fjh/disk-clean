import { describe, expect, it, vi, beforeEach } from 'vitest'
import { validateCleanupActions } from '../src/main/cleanup/safety-validator'
import { createScanSession } from '../src/main/scan/scan-session-store'
import type { CleanupAction, ScanCandidate } from '../src/shared/types'

vi.mock('../src/main/rules', () => ({
  getProtectedPaths: () => [],
  getPathAccessPolicy: () => ({ denyRead: [], readOnlyHighRisk: [], denyDelete: [] }),
  getAllRulesWithMeta: () => [
    {
      id: 'downloads-installers',
      name: '下载安装包',
      category: 'recommended',
      paths: ['C:\\Downloads'],
      patterns: ['*.exe'],
      defaultChecked: false,
      enabled: true,
      source: 'builtin'
    }
  ]
}))

function makeCandidate(id: string, path: string): ScanCandidate {
  return {
    id,
    ruleId: 'downloads-installers',
    ruleName: '下载安装包',
    category: 'recommended',
    contentType: 'download-leftover',
    drive: 'C:',
    path,
    size: 100,
    sizeIsEstimate: false,
    snapshotComplete: true,
    entryKind: 'file',
    mtimeMs: Date.now(),
    deletable: true,
    autoSelect: false,
    source: 'rule'
  }
}

describe('safety-validator session trust', () => {
  beforeEach(() => {
    createScanSession('C:', 'quick', 'v1', [makeCandidate('c1', 'C:\\Downloads\\a.exe')])
  })

  it('rejects expired or unknown session', async () => {
    const actions: CleanupAction[] = [
      {
        candidateId: 'c1',
        ruleId: 'downloads-installers',
        target: 'C:\\Downloads\\a.exe',
        operation: 'trash',
        estimatedLogicalBytes: 100
      }
    ]
    const result = await validateCleanupActions('unknown-session', actions)
    expect(result.approved).toHaveLength(0)
    expect(result.rejected[0]?.reason).toContain('会话')
  })

  it('rejects path tampering from renderer', async () => {
    const session = createScanSession('C:', 'quick', 'v2', [makeCandidate('c2', 'C:\\Downloads\\a.exe')])
    const actions: CleanupAction[] = [
      {
        candidateId: 'c2',
        ruleId: 'downloads-installers',
        target: 'C:\\Downloads\\other.exe',
        operation: 'trash',
        estimatedLogicalBytes: 100
      }
    ]
    const result = await validateCleanupActions(session.sessionId, actions)
    expect(result.approved).toHaveLength(0)
    expect(result.rejected[0]?.reason).toContain('不一致')
  })
})

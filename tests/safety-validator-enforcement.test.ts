import { mkdtempSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, vi } from 'vitest'
import { validateCleanupActions } from '../src/main/cleanup/safety-validator'
import { createScanSession } from '../src/main/scan/scan-session-store'
import { normalizeCandidate } from '../src/shared/candidate-model'
import type { CleanupAction, ScanCandidate } from '../src/shared/types'

const manualRoot = mkdtempSync(join(tmpdir(), 'disk-clean-manual-'))
const manualFile = join(manualRoot, 'item.dat')
writeFileSync(manualFile, 'manual')
const manualStat = statSync(manualFile)

vi.mock('../src/main/rules', () => ({
  getProtectedPaths: () => [],
  getPathAccessPolicy: () => ({ denyRead: [], readOnlyHighRisk: [], denyDelete: [] }),
  getAllRulesWithMeta: () => [
    {
      id: 'manual-rule',
      name: '手动清理项',
      category: 'recommended',
      paths: [manualRoot],
      patterns: ['*'],
      defaultChecked: false,
      enabled: true,
      source: 'builtin',
      cleanupMethod: 'manual',
      deletable: true
    }
  ]
}))

function makeCandidate(id: string, ruleId: string, path: string): ScanCandidate {
  return normalizeCandidate({
    id,
    ruleId,
    ruleName: ruleId,
    category: 'recommended',
    contentType: 'app-cache',
    drive: 'C:',
    path,
    size: manualStat.size,
    sizeIsEstimate: false,
    snapshotComplete: true,
    entryKind: 'file',
    mtimeMs: manualStat.mtimeMs,
    deletable: true,
    autoSelect: false,
    source: 'rule',
    discoverySources: ['rule'],
    evidence: [],
    judgment: {
      status: 'caution',
      source: 'legacy-rule',
      confidence: 'medium',
      basis: ['规则命中'],
      judgmentOrigin: 'local-rule'
    },
    executionSafety: 'rule-eligible',
    selection: { selectable: true },
    suggestedAction: 'recycle'
  })
}

describe('safety-validator metadata enforcement', () => {
  it('rejects delete for manual cleanupMethod even when deletable is true', async () => {
    const session = createScanSession('C:', 'quick', 'enforce-v2', [
      makeCandidate('manual', 'manual-rule', manualFile)
    ])
    const actions: CleanupAction[] = [
      {
        candidateId: 'manual',
        ruleId: 'manual-rule',
        target: manualFile,
        operation: 'trash',
        estimatedLogicalBytes: manualStat.size
      }
    ]
    const result = await validateCleanupActions(session.sessionId, actions)
    expect(result.approved).toHaveLength(0)
    expect(result.rejected[0]?.reason).toContain('不允许删除')
    expect(result.rejected[0]?.code).toBe('ACTION_NOT_ALLOWED')
  })
})

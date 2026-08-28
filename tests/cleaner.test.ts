import { mkdtempSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, vi } from 'vitest'
import { executeCleanup } from '../src/main/cleanup/cleaner'
import { createCleanupExecutionSnapshot } from '../src/main/cleanup/cleanup-execution-guard'
import type { ValidatedAction } from '../src/main/cleanup/safety-validator'

vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn(async () => undefined)
  }
}))

vi.mock('../src/main/rules', () => ({
  getProtectedPaths: () => [],
  getPathAccessPolicy: () => ({ denyRead: [], readOnlyHighRisk: [], denyDelete: [] }),
  getAllRulesWithMeta: () => []
}))

describe('cleaner semantics', () => {
  it('reports movedToTrashBytes not actuallyReclaimedBytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-clean-cleaner-'))
    const filePath = join(dir, 'a.txt')
    writeFileSync(filePath, 'x'.repeat(1024))
    const stat = statSync(filePath)

    const snapshot = await createCleanupExecutionSnapshot({
      candidate: {
        id: 'a',
        ruleId: 'r',
        ruleName: 'R',
        category: 'safe',
        contentType: 'app-cache',
        drive: 'C:',
        path: filePath,
        size: stat.size,
        sizeIsEstimate: true,
        snapshotComplete: true,
        entryKind: 'file',
        mtimeMs: stat.mtimeMs,
        deletable: true,
        autoSelect: true,
        source: 'rule',
        discoverySources: ['rule'],
        evidence: [],
        judgment: {
          status: 'suggested',
          source: 'legacy-rule',
          confidence: 'high',
          basis: [],
          judgmentOrigin: 'local-rule'
        },
        executionSafety: 'rule-eligible',
        selection: { selectable: true },
        suggestedAction: 'recycle'
      },
      resolvedPath: filePath,
      authorizationSource: 'local-rule'
    })

    const actions: ValidatedAction[] = [
      {
        candidateId: 'a',
        ruleId: 'r',
        target: filePath,
        operation: 'trash',
        estimatedLogicalBytes: 1024,
        resolvedPath: filePath,
        authorizationSource: 'local-rule',
        executionSnapshot: snapshot
      }
    ]

    const result = await executeCleanup('plan-1', actions, [])
    expect(result.movedToTrashBytes).toBe(1024)
    expect(result.actuallyReclaimedBytes).toBe(0)
    expect(result.reclaimState).toBe('pending')
    expect(result.recoveryMode).toBe('recycle-bin')
    expect(result.moved).toBe(1)
  })
})

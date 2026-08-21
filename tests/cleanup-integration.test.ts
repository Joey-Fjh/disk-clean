import { mkdtempSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createScanSession } from '../src/main/scan/scan-session-store'
import { validateCleanupActions } from '../src/main/cleanup/safety-validator'
import { runCleanup } from '../src/main/cleanup/cleanup-service'
import { measurePathDetailed } from '../src/main/scanner/measure-size'
import type { ScanCandidate } from '../src/shared/types'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(async () => undefined) }
}))

const ruleRoot = mkdtempSync(join(tmpdir(), 'disk-clean-integ-'))
const cacheDir = join(ruleRoot, 'cache')
mkdirSync(cacheDir, { recursive: true })
writeFileSync(join(cacheDir, 'thumb.dat'), 'x'.repeat(200))

const cacheStat = statSync(cacheDir)
let cacheSize = 0

const testRule = {
  id: 'test-cache',
  name: '测试缓存',
  category: 'safe' as const,
  paths: [ruleRoot],
  subdirs: ['cache'],
  defaultChecked: true,
  enabled: true,
  source: 'builtin' as const
}

vi.mock('../src/main/rules', () => ({
  getProtectedPaths: () => [],
  getAllRulesWithMeta: () => [testRule]
}))

function makeDirCandidate(id: string, path: string): ScanCandidate {
  return {
    id,
    ruleId: 'test-cache',
    ruleName: '测试缓存',
    category: 'safe',
    contentType: 'app-cache',
    drive: 'C:',
    path,
    size: cacheSize,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    mtimeMs: cacheStat.mtimeMs,
    deletable: true,
    autoSelect: true,
    source: 'rule',
    ruleSource: 'builtin'
  }
}

describe('cleanup integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    cacheSize = (await measurePathDetailed(cacheDir, 32)).size
  })

  it('directory candidate passes validation and cleanup', async () => {
    const session = createScanSession('C:', 'quick', 'v1', [makeDirCandidate('c1', cacheDir)])
    const result = await runCleanup({ sessionId: session.sessionId, candidateIds: ['c1'] })

    expect(result.moved).toBe(1)
    expect(result.movedToTrashBytes).toBe(cacheSize)
    expect(result.actuallyReclaimedBytes).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('rejects invalid candidate id with skipped count', async () => {
    const session = createScanSession('C:', 'quick', 'v1', [makeDirCandidate('c1', cacheDir)])
    const result = await runCleanup({
      sessionId: session.sessionId,
      candidateIds: ['c1', 'missing-id', 'c1']
    })

    expect(result.moved).toBe(1)
    expect(result.skipped).toBeGreaterThanOrEqual(2)
    expect(result.rejected.some((r) => r.reason.includes('不属于'))).toBe(true)
    expect(result.rejected.some((r) => r.reason.includes('重复'))).toBe(true)
  })
})

describe('directory snapshot validation', () => {
  it('approves directory when recursive size unchanged', async () => {
    const session = createScanSession('C:', 'quick', 'v2', [makeDirCandidate('dir1', cacheDir)])
    const { approved, rejected } = await validateCleanupActions(session.sessionId, [
      {
        candidateId: 'dir1',
        ruleId: 'test-cache',
        target: cacheDir,
        operation: 'trash',
        estimatedLogicalBytes: cacheSize
      }
    ])
    expect(rejected).toHaveLength(0)
    expect(approved).toHaveLength(1)
  })
})

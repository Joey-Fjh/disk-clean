import { mkdtempSync, mkdirSync, writeFileSync, statSync, unlinkSync, utimesSync } from 'fs'
import { lstat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, vi } from 'vitest'
import type { Stats } from 'fs'
import { validateAndCreateCleanupExecutionSnapshot } from '../src/main/cleanup/cleanup-execution-guard'
import { validateCleanupActions } from '../src/main/cleanup/safety-validator'
import { executeCleanup } from '../src/main/cleanup/cleaner'
import { createScanSession } from '../src/main/scan/scan-session-store'
import { normalizeCandidate } from '../src/shared/candidate-model'
import { measurePathDetailed } from '../src/main/scanner/measure-size'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(async () => undefined) }
}))

vi.mock('../src/main/rules', () => ({
  getProtectedPaths: () => [],
  getPathAccessPolicy: () => ({ denyRead: [], readOnlyHighRisk: [], denyDelete: [] }),
  getAllRulesWithMeta: () => []
}))

function makeAgentFileCandidate(id: string, filePath: string) {
  const stat = statSync(filePath)
  return normalizeCandidate({
    id,
    ruleId: '__analyzer__',
    ruleName: '分析项',
    category: 'recommended',
    contentType: 'large-dir',
    drive: 'C:',
    path: filePath,
    size: stat.size,
    sizeIsEstimate: false,
    snapshotComplete: true,
    entryKind: 'file',
    mtimeMs: stat.mtimeMs,
    deletable: false,
    autoSelect: true,
    source: 'analyzer',
    discoverySources: ['agent'],
    evidence: [],
    judgment: {
      status: 'suggested',
      source: 'agent',
      confidence: 'high',
      basis: ['Agent 建议'],
      judgmentOrigin: 'agent-session',
      agentVerdict: 'clean'
    },
    executionSafety: 'agent-confirmable',
    selection: { selectable: true },
    suggestedAction: 'recycle'
  })
}

function mockStats(partial: Partial<Stats> & { isFile?: () => boolean; isDirectory?: () => boolean }): Stats {
  return {
    dev: 1n,
    ino: 42n,
    birthtimeNs: 100n,
    ctimeNs: 200n,
    mtimeNs: 300n,
    birthtimeMs: 100,
    ctimeMs: 200,
    mtimeMs: 300,
    size: 128n,
    isSymbolicLink: () => false,
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    ...partial
  } as Stats
}

describe('validateAndCreateCleanupExecutionSnapshot', () => {
  it('rejects replacement with different size on the same lstat read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-clean-snap-val-'))
    const filePath = join(dir, 'one-shot.dat')
    writeFileSync(filePath, 'a'.repeat(128))
    const candidate = makeAgentFileCandidate('f1', filePath)

    const result = await validateAndCreateCleanupExecutionSnapshot(
      { candidate, resolvedPath: filePath, authorizationSource: 'agent-session' },
      {
        lstat: async () =>
          mockStats({
            size: 256n,
            mtimeMs: candidate.mtimeMs,
            mtimeNs: BigInt(Math.trunc(candidate.mtimeMs)) * 1_000_000n
          }),
        measureDirectorySize: async () => ({ size: 0, incomplete: true })
      }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('大小')
  })

  it('rejects special file types', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-clean-snap-special-'))
    const filePath = join(dir, 'pipe-like.dat')
    writeFileSync(filePath, 'x')
    const candidate = makeAgentFileCandidate('sp1', filePath)

    const result = await validateAndCreateCleanupExecutionSnapshot(
      { candidate, resolvedPath: filePath, authorizationSource: 'agent-session' },
      {
        lstat: async () =>
          mockStats({
            isFile: () => false,
            isDirectory: () => false,
            isFIFO: () => true
          }),
        measureDirectorySize: async () => ({ size: 0, incomplete: true })
      }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('特殊文件类型')
  })

  it('rejects when path disappears during directory measurement', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-clean-snap-vanish-'))
    const targetDir = join(dir, 'cache')
    mkdirSync(targetDir)
    writeFileSync(join(targetDir, 'a.dat'), 'x'.repeat(100))
    const size = (await measurePathDetailed(targetDir, 8)).size
    const dirStat = statSync(targetDir)
    const candidate = normalizeCandidate({
      ...makeAgentFileCandidate('d1', join(targetDir, 'a.dat')),
      id: 'd1',
      path: targetDir,
      entryKind: 'directory',
      size,
      sizeIsEstimate: true,
      snapshotComplete: true,
      mtimeMs: dirStat.mtimeMs
    })

    let lstatCalls = 0
    const result = await validateAndCreateCleanupExecutionSnapshot(
      { candidate, resolvedPath: targetDir, authorizationSource: 'agent-session' },
      {
        lstat: async () => {
          lstatCalls += 1
          if (lstatCalls === 1) return lstat(targetDir, { bigint: true })
          throw new Error('ENOENT')
        },
        measureDirectorySize: async () => ({ size, incomplete: false })
      }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('无法读取')
  })

  it('rejects directory when identity anchor changes after measurement', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-clean-snap-dir-race-'))
    const targetDir = join(dir, 'cache')
    mkdirSync(targetDir)
    writeFileSync(join(targetDir, 'a.dat'), 'x'.repeat(100))
    const size = (await measurePathDetailed(targetDir, 8)).size
    const dirStat = statSync(targetDir)
    const candidate = normalizeCandidate({
      ...makeAgentFileCandidate('d2', join(targetDir, 'a.dat')),
      id: 'd2',
      path: targetDir,
      entryKind: 'directory',
      size,
      sizeIsEstimate: true,
      snapshotComplete: true,
      mtimeMs: dirStat.mtimeMs
    })

    let lstatCalls = 0
    const result = await validateAndCreateCleanupExecutionSnapshot(
      { candidate, resolvedPath: targetDir, authorizationSource: 'agent-session' },
      {
        lstat: async () => {
          lstatCalls += 1
          if (lstatCalls <= 1) return lstat(targetDir, { bigint: true })
          const replaced = join(dir, 'replaced')
          mkdirSync(replaced, { recursive: true })
          writeFileSync(join(replaced, 'a.dat'), 'x'.repeat(100))
          return lstat(replaced, { bigint: true })
        },
        measureDirectorySize: async () => ({ size, incomplete: false })
      }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('身份')
  })

  it('captures unchanged file identity and allows cleaner execution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-clean-snap-ok-'))
    const filePath = join(dir, 'stable.dat')
    writeFileSync(filePath, 'z'.repeat(64))
    const candidate = makeAgentFileCandidate('ok1', filePath)

    const result = await validateAndCreateCleanupExecutionSnapshot({
      candidate,
      resolvedPath: filePath,
      authorizationSource: 'agent-session'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const cleanup = await executeCleanup(
      'plan-snap-ok',
      [
        {
          candidateId: 'ok1',
          ruleId: '__analyzer__',
          target: filePath,
          operation: 'trash',
          estimatedLogicalBytes: candidate.size,
          resolvedPath: filePath,
          authorizationSource: 'agent-session',
          executionSnapshot: result.snapshot
        }
      ],
      []
    )
    expect(cleanup.moved).toBe(1)
  })
})

describe('validateCleanupActions snapshot isolation', () => {
  it('rejects first action snapshot failure and still approves second', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disk-clean-snap-multi-'))
    const firstPath = join(dir, 'first.dat')
    const secondPath = join(dir, 'second.dat')
    writeFileSync(firstPath, 'a'.repeat(50))
    writeFileSync(secondPath, 'b'.repeat(80))

    const first = makeAgentFileCandidate('m1', firstPath)
    const second = makeAgentFileCandidate('m2', secondPath)
    const session = createScanSession('C:', 'quick', 'v1', [first, second])

    const { approved, rejected } = await validateCleanupActions(session.sessionId, [
      {
        candidateId: 'm1',
        ruleId: '__analyzer__',
        target: firstPath,
        operation: 'trash',
        estimatedLogicalBytes: first.size
      },
      {
        candidateId: 'm2',
        ruleId: '__analyzer__',
        target: secondPath,
        operation: 'trash',
        estimatedLogicalBytes: second.size
      }
    ])

    unlinkSync(firstPath)
    const { approved: approvedAfterLoss, rejected: rejectedAfterLoss } = await validateCleanupActions(
      session.sessionId,
      [
        {
          candidateId: 'm1',
          ruleId: '__analyzer__',
          target: firstPath,
          operation: 'trash',
          estimatedLogicalBytes: first.size
        },
        {
          candidateId: 'm2',
          ruleId: '__analyzer__',
          target: secondPath,
          operation: 'trash',
          estimatedLogicalBytes: second.size
        }
      ]
    )

    expect(approvedAfterLoss).toHaveLength(1)
    expect(approvedAfterLoss[0]?.candidateId).toBe('m2')
    expect(rejectedAfterLoss).toHaveLength(1)
    expect(rejectedAfterLoss[0]?.code).toBe('SNAPSHOT_STALE')
    expect(approved).toHaveLength(2)
    expect(rejected).toHaveLength(0)
  })
})

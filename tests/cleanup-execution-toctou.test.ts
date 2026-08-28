import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  statSync,
  appendFileSync,
  unlinkSync,
  utimesSync,
  renameSync,
  symlinkSync,
  rmSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createScanSession } from '../src/main/scan/scan-session-store'
import { validateCleanupActions } from '../src/main/cleanup/safety-validator'
import { executeCleanup } from '../src/main/cleanup/cleaner'
import { createCleanupExecutionSnapshot } from '../src/main/cleanup/cleanup-execution-guard'
import { normalizeCandidate } from '../src/shared/candidate-model'
import { measurePathDetailed } from '../src/main/scanner/measure-size'
import type { ValidatedAction } from '../src/main/cleanup/safety-validator'
import { shell } from 'electron'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn(async () => undefined) }
}))

const ruleRoot = mkdtempSync(join(tmpdir(), 'disk-clean-toctou-'))
const cacheDir = join(ruleRoot, 'cache')
mkdirSync(cacheDir, { recursive: true })
writeFileSync(join(cacheDir, 'target.dat'), 'x'.repeat(400))

const protectedRoot = mkdtempSync(join(tmpdir(), 'disk-clean-protected-'))

const testRule = {
  id: 'test-cache',
  name: '测试缓存',
  category: 'safe' as const,
  paths: [ruleRoot],
  subdirs: ['cache'],
  defaultChecked: true,
  enabled: true,
  source: 'builtin' as const,
  cleanupMethod: 'trash' as const
}

vi.mock('../src/main/rules', () => ({
  getProtectedPaths: () => [protectedRoot],
  getPathAccessPolicy: () => ({ denyRead: [], readOnlyHighRisk: [], denyDelete: [] }),
  getAllRulesWithMeta: () => [testRule]
}))

function probeSymlink(type: 'file' | 'junction'): boolean {
  const root = mkdtempSync(join(tmpdir(), `disk-clean-symlink-probe-${type}-`))
  try {
    const target = join(root, 'target')
    const link = join(root, 'link')
    if (type === 'file') {
      writeFileSync(target, 'probe')
      symlinkSync(target, link, 'file')
    } else {
      mkdirSync(target)
      symlinkSync(target, link, 'junction')
    }
    return true
  } catch {
    return false
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const fileSymlinkSupported = probeSymlink('file')
const junctionSupported = probeSymlink('junction')

async function makeValidatedDirectoryAction(dirPath: string, candidateId = 'c1') {
  const dirStat = statSync(dirPath)
  const size = (await measurePathDetailed(dirPath, 32)).size
  const candidate = normalizeCandidate({
    id: candidateId,
    ruleId: 'test-cache',
    ruleName: '测试缓存',
    category: 'safe',
    contentType: 'app-cache',
    drive: 'C:',
    path: dirPath,
    size,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    mtimeMs: dirStat.mtimeMs,
    deletable: true,
    autoSelect: true,
    source: 'rule',
    discoverySources: ['rule'],
    evidence: [],
    judgment: {
      status: 'suggested',
      source: 'legacy-rule',
      confidence: 'high',
      basis: ['规则命中'],
      judgmentOrigin: 'local-rule'
    },
    executionSafety: 'rule-eligible',
    selection: { selectable: true },
    suggestedAction: 'recycle'
  })
  const session = createScanSession('C:', 'quick', 'v1', [candidate])
  const { approved, rejected } = await validateCleanupActions(session.sessionId, [
    {
      candidateId,
      ruleId: 'test-cache',
      target: dirPath,
      operation: 'trash',
      estimatedLogicalBytes: size
    }
  ])
  return { approved, rejected }
}

function makeFileCandidate(id: string, filePath: string) {
  const stat = statSync(filePath)
  return normalizeCandidate({
    id,
    ruleId: 'test-cache',
    ruleName: '测试缓存',
    category: 'safe',
    contentType: 'app-cache',
    drive: 'C:',
    path: filePath,
    size: stat.size,
    sizeIsEstimate: false,
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
      basis: ['规则命中'],
      judgmentOrigin: 'local-rule'
    },
    executionSafety: 'rule-eligible',
    selection: { selectable: true },
    suggestedAction: 'recycle'
  })
}

async function makeDirectFileValidatedAction(filePath: string, candidateId: string): Promise<ValidatedAction[]> {
  const stat = statSync(filePath)
  const candidate = makeFileCandidate(candidateId, filePath)
  const snapshot = await createCleanupExecutionSnapshot({
    candidate,
    resolvedPath: filePath,
    authorizationSource: 'agent-session'
  })
  return [
    {
      candidateId,
      ruleId: 'test-cache',
      target: filePath,
      operation: 'trash',
      estimatedLogicalBytes: stat.size,
      resolvedPath: filePath,
      authorizationSource: 'agent-session',
      executionSnapshot: snapshot
    }
  ]
}

async function makeDirectDirectoryValidatedAction(
  dirPath: string,
  candidateId: string
): Promise<ValidatedAction[]> {
  const dirStat = statSync(dirPath)
  const size = (await measurePathDetailed(dirPath, 32)).size
  const candidate = normalizeCandidate({
    id: candidateId,
    ruleId: 'test-cache',
    ruleName: '测试缓存',
    category: 'safe',
    contentType: 'app-cache',
    drive: 'C:',
    path: dirPath,
    size,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    mtimeMs: dirStat.mtimeMs,
    deletable: true,
    autoSelect: true,
    source: 'rule',
    discoverySources: ['rule'],
    evidence: [],
    judgment: {
      status: 'suggested',
      source: 'legacy-rule',
      confidence: 'high',
      basis: ['规则命中'],
      judgmentOrigin: 'local-rule'
    },
    executionSafety: 'rule-eligible',
    selection: { selectable: true },
    suggestedAction: 'recycle'
  })
  const snapshot = await createCleanupExecutionSnapshot({
    candidate,
    resolvedPath: dirPath,
    authorizationSource: 'local-rule'
  })
  return [
    {
      candidateId,
      ruleId: 'test-cache',
      target: dirPath,
      operation: 'trash',
      estimatedLogicalBytes: size,
      resolvedPath: dirPath,
      authorizationSource: 'local-rule',
      executionSnapshot: snapshot
    }
  ]
}

describe('cleaner execution toctou guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeFileSync(join(cacheDir, 'target.dat'), 'x'.repeat(400))
  })

  it('rejects trash when directory content changes after validator snapshot', async () => {
    const { approved, rejected } = await makeValidatedDirectoryAction(cacheDir)
    expect(rejected).toHaveLength(0)
    expect(approved).toHaveLength(1)

    appendFileSync(join(cacheDir, 'target.dat'), 'y'.repeat(800))

    const result = await executeCleanup('plan-toctou', approved, [])
    expect(result.moved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.code).toBe('SNAPSHOT_STALE')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('rejects file replaced with same size and restored mtime', async () => {
    const filePath = join(cacheDir, 'swap-target.dat')
    writeFileSync(filePath, 'a'.repeat(400))
    const before = statSync(filePath)

    const approved = await makeDirectFileValidatedAction(filePath, 'file-swap')
    unlinkSync(filePath)
    writeFileSync(filePath, 'b'.repeat(400))
    utimesSync(filePath, before.atime, before.mtime)

    const result = await executeCleanup('plan-file-swap', approved, [])
    expect(result.moved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.code).toBe('SNAPSHOT_STALE')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('rejects directory root replaced with same aggregate size and mtime', async () => {
    const targetDir = join(cacheDir, 'dir-swap')
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'target.dat'), 'x'.repeat(400))
    const beforeStat = statSync(targetDir)

    const approved = await makeDirectDirectoryValidatedAction(targetDir, 'dir-swap')
    const backupDir = `${targetDir}.bak`
    renameSync(targetDir, backupDir)
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'target.dat'), 'x'.repeat(400))
    utimesSync(targetDir, beforeStat.atime, beforeStat.mtime)

    const result = await executeCleanup('plan-dir-swap', approved, [])
    expect(result.moved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.code).toBe('SNAPSHOT_STALE')
    expect(shell.trashItem).not.toHaveBeenCalled()
    rmSync(backupDir, { recursive: true, force: true })
  })

  it.skipIf(!fileSymlinkSupported)('rejects path replaced by symlink before trash', async () => {
    const filePath = join(cacheDir, 'symlink-target.dat')
    writeFileSync(filePath, 'a'.repeat(200))
    writeFileSync(join(cacheDir, 'symlink-other.dat'), 'b'.repeat(200))
    const approved = await makeDirectFileValidatedAction(filePath, 'sym-1')
    unlinkSync(filePath)
    symlinkSync(join(cacheDir, 'symlink-other.dat'), filePath, 'file')

    const result = await executeCleanup('plan-symlink', approved, [])
    expect(result.moved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.code).toBe('SNAPSHOT_STALE')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it.skipIf(!junctionSupported)('rejects directory replaced by junction before trash', async () => {
    const targetDir = join(cacheDir, 'junction-target')
    const otherDir = join(cacheDir, 'junction-other')
    mkdirSync(targetDir, { recursive: true })
    mkdirSync(otherDir, { recursive: true })
    writeFileSync(join(targetDir, 'inner.dat'), 'x'.repeat(120))
    writeFileSync(join(otherDir, 'inner.dat'), 'y'.repeat(120))

    const approved = await makeDirectDirectoryValidatedAction(targetDir, 'junction-1')
    rmSync(targetDir, { recursive: true, force: true })
    symlinkSync(otherDir, targetDir, 'junction')

    const result = await executeCleanup('plan-junction', approved, [])
    expect(result.moved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.code).toBe('SNAPSHOT_STALE')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('rejects second item when first item executes then second path is replaced', async () => {
    const firstPath = join(cacheDir, 'multi-first.dat')
    const secondPath = join(cacheDir, 'multi-second.dat')
    writeFileSync(firstPath, 'a'.repeat(100))
    writeFileSync(secondPath, 'b'.repeat(100))

    const approvedFirst = await makeDirectFileValidatedAction(firstPath, 'm1')
    const approvedSecond = await makeDirectFileValidatedAction(secondPath, 'm2')
    const approved = [...approvedFirst, ...approvedSecond]

    let trashCalls = 0
    vi.mocked(shell.trashItem).mockImplementation(async () => {
      trashCalls += 1
      if (trashCalls === 1) {
        const before = statSync(secondPath)
        unlinkSync(secondPath)
        writeFileSync(secondPath, 'c'.repeat(100))
        utimesSync(secondPath, before.atime, before.mtime)
      }
    })

    const result = await executeCleanup('plan-multi', approved, [])
    expect(result.moved).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.code).toBe('SNAPSHOT_STALE')
    expect(shell.trashItem).toHaveBeenCalledTimes(1)
  })

  it.skipIf(!fileSymlinkSupported)('rejects path that becomes protected alias without calling trashItem', async () => {
    const linkPath = join(cacheDir, 'alias-link.dat')
    const protectedTarget = join(protectedRoot, 'real-target.dat')
    writeFileSync(protectedTarget, 'protected-content')
    writeFileSync(linkPath, 'visible-content')

    const approved = await makeDirectFileValidatedAction(linkPath, 'alias-1')
    unlinkSync(linkPath)
    symlinkSync(protectedTarget, linkPath, 'file')

    const result = await executeCleanup('plan-protected-alias', approved, [])
    expect(result.moved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.code).toBe('SNAPSHOT_STALE')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it.skipIf(!junctionSupported)('rejects protected directory reached through intermediate junction', async () => {
    const visibleDir = join(cacheDir, 'visible-junction')
    const protectedDir = join(protectedRoot, 'protected-inner')
    mkdirSync(protectedDir, { recursive: true })
    writeFileSync(join(protectedDir, 'secret.dat'), 'protected')
    mkdirSync(visibleDir, { recursive: true })
    writeFileSync(join(visibleDir, 'entry.dat'), 'visible')

    const approved = await makeDirectDirectoryValidatedAction(visibleDir, 'junction-protected')
    rmSync(visibleDir, { recursive: true, force: true })
    symlinkSync(protectedDir, visibleDir, 'junction')

    const result = await executeCleanup('plan-protected-junction', approved, [])
    expect(result.moved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.code).toBe('SNAPSHOT_STALE')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('allows trash when snapshot still matches', async () => {
    const { approved } = await makeValidatedDirectoryAction(cacheDir)
    const result = await executeCleanup('plan-ok', approved, [])
    expect(result.moved).toBe(1)
    expect(result.failed).toBe(0)
    expect(shell.trashItem).toHaveBeenCalledTimes(1)
  })
})

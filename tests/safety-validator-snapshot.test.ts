import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import { validateCandidateSnapshot } from '../src/main/cleanup/safety-validator'
import { measurePathDetailed } from '../src/main/scanner/measure-size'
import type { ScanCandidate } from '../src/shared/types'

function baseCandidate(overrides: Partial<ScanCandidate>): ScanCandidate {
  return {
    id: 'x',
    ruleId: 'r',
    ruleName: 'r',
    category: 'safe',
    contentType: 'system-temp',
    drive: 'C:',
    path: 'C:\\temp\\x',
    size: 0,
    sizeIsEstimate: false,
    snapshotComplete: true,
    entryKind: 'file',
    deletable: true,
    autoSelect: false,
    source: 'rule',
    ...overrides
  }
}

describe('validateCandidateSnapshot fail-closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'disk-clean-snap-'))

  it('rejects when file was replaced by directory', async () => {
    const filePath = join(root, 'swap-file')
    writeFileSync(filePath, '')
    const st = statSync(filePath)
    const candidate = baseCandidate({
      path: filePath,
      size: 0,
      mtimeMs: st.mtimeMs,
      entryKind: 'file'
    })
    rmSync(filePath)
    mkdirSync(filePath)

    const err = await validateCandidateSnapshot(candidate, filePath)
    expect(err).toBe('路径类型自扫描后已变化')
  })

  it('rejects when directory was replaced by file', async () => {
    const dirPath = join(root, 'swap-dir')
    mkdirSync(dirPath)
    const st = statSync(dirPath)
    const measured = await measurePathDetailed(dirPath, 32)
    const candidate = baseCandidate({
      path: dirPath,
      size: measured.size,
      mtimeMs: st.mtimeMs,
      entryKind: 'directory',
      snapshotComplete: true
    })
    rmSync(dirPath, { recursive: true })
    writeFileSync(dirPath, 'hello')

    const err = await validateCandidateSnapshot(candidate, dirPath)
    expect(err).toBe('路径类型自扫描后已变化')
  })

  it('rejects zero-byte file that grew', async () => {
    const filePath = join(root, 'grow.txt')
    writeFileSync(filePath, 'data')
    const after = statSync(filePath)
    const candidate = baseCandidate({
      path: filePath,
      size: 0,
      mtimeMs: after.mtimeMs,
      entryKind: 'file'
    })

    const err = await validateCandidateSnapshot(candidate, filePath)
    expect(err).toBe('文件大小与扫描时不一致')
  })

  it('rejects mtime change', async () => {
    const filePath = join(root, 'mtime.txt')
    writeFileSync(filePath, 'x')
    const st = statSync(filePath)
    const candidate = baseCandidate({
      path: filePath,
      size: st.size,
      mtimeMs: st.mtimeMs - 10_000,
      entryKind: 'file'
    })

    const err = await validateCandidateSnapshot(candidate, filePath)
    expect(err).toBe('自扫描后已发生变化')
  })

  it('rejects incomplete directory snapshot', async () => {
    const dirPath = join(root, 'incomplete')
    mkdirSync(dirPath)
    writeFileSync(join(dirPath, 'a.txt'), 'a')
    const st = statSync(dirPath)
    const candidate = baseCandidate({
      path: dirPath,
      size: 1,
      mtimeMs: st.mtimeMs,
      entryKind: 'directory',
      snapshotComplete: false
    })

    const err = await validateCandidateSnapshot(candidate, dirPath)
    expect(err).toBe('目录快照不完整，无法安全清理')
  })
})

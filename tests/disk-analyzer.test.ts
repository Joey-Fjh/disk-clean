import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import { normalizeCleanupCandidateIds } from '../src/main/cleanup/cleanup-service'
import { listDriveRootEntries } from '../src/main/scanner/rule-matcher'

describe('normalizeCleanupCandidateIds', () => {
  it('deduplicates and reports duplicates', () => {
    const { uniqueIds, preRejected } = normalizeCleanupCandidateIds(['a', 'b', 'a'])
    expect(uniqueIds).toEqual(['a', 'b'])
    expect(preRejected.some((r) => r.reason.includes('重复'))).toBe(true)
  })

  it('rejects overly long ids', () => {
    const longId = 'x'.repeat(3000)
    const { uniqueIds, preRejected } = normalizeCleanupCandidateIds([longId])
    expect(uniqueIds).toHaveLength(0)
    expect(preRejected.some((r) => r.reason.includes('过长'))).toBe(true)
  })
})

describe('listDriveRootEntries', () => {
  it('returns only first-level files and directories without parent overlap', async () => {
    const driveRoot = mkdtempSync(join(tmpdir(), 'disk-clean-drive-'))
    const users = join(driveRoot, 'Users')
    const windows = join(driveRoot, 'Windows')
    const winsxs = join(windows, 'WinSxS')
    mkdirSync(users)
    mkdirSync(winsxs, { recursive: true })
    writeFileSync(join(driveRoot, 'pagefile.sys'), 'x')
    writeFileSync(join(driveRoot, 'setup.iso'), 'iso')

    const entries = await listDriveRootEntries(driveRoot)
    const normalized = entries.map((p) => p.toLowerCase())

    expect(normalized).toContain(join(driveRoot, 'Users').toLowerCase())
    expect(normalized).toContain(join(driveRoot, 'Windows').toLowerCase())
    expect(normalized).toContain(join(driveRoot, 'pagefile.sys').toLowerCase())
    expect(normalized).toContain(join(driveRoot, 'setup.iso').toLowerCase())
    expect(normalized).not.toContain(winsxs.toLowerCase())

    const windowsEntry = normalized.find((p) => p.endsWith('\\windows'))
    const nestedWinsxs = normalized.find((p) => p.includes('winsxs'))
    if (windowsEntry && nestedWinsxs) {
      expect(nestedWinsxs.startsWith(windowsEntry + '\\')).toBe(false)
    }
  })
})

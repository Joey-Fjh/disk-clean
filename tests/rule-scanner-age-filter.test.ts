import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const readdir = vi.fn()
const lstat = vi.fn()

vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => readdir(...args),
  lstat: (...args: unknown[]) => lstat(...args)
}))

vi.mock('../src/main/scanner/measure-size', () => ({
  measurePathSizeDetailed: vi.fn(async () => ({ size: 0, incomplete: false }))
}))

vi.mock('../src/main/scanner/scan-controller', () => ({
  isScanCancelled: () => false,
  yieldToEventLoop: async () => undefined
}))

vi.mock('../src/main/rules', () => ({
  getActiveRulesWithMeta: vi.fn(() => []),
  getProtectedPaths: () => []
}))

import { runRuleScan } from '../src/main/scanner/rule-scanner'
import { getActiveRulesWithMeta } from '../src/main/rules'

describe('rule scanner maxAgeDays', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'disk-clean-age-'))
    readdir.mockReset()
    lstat.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not emit parent directory when it contains a recent file', async () => {
    const oldDir = join(root, 'old-folder')
    const recentFile = join(oldDir, 'new-running-file')
    mkdirSync(oldDir, { recursive: true })
    writeFileSync(recentFile, 'x')
    const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const recentTime = new Date()
    utimesSync(oldDir, oldTime, oldTime)
    utimesSync(recentFile, recentTime, recentTime)

    vi.mocked(getActiveRulesWithMeta).mockReturnValue([
      {
        id: 'user-temp',
        name: 'Temp',
        category: 'safe',
        contentType: 'system-temp',
        paths: [root],
        maxAgeDays: 7,
        defaultChecked: true,
        enabled: true,
        source: 'builtin'
      }
    ])

    readdir.mockImplementation(async (dir: string) => {
      if (dir === root) {
        return [{ name: 'old-folder', isSymbolicLink: () => false, isFile: () => false }]
      }
      if (dir === oldDir) {
        return [{ name: 'new-running-file', isSymbolicLink: () => false, isFile: () => true }]
      }
      return []
    })

    lstat.mockImplementation(async (p: string) => {
      if (p === oldDir) {
        return {
          isSymbolicLink: () => false,
          isFile: () => false,
          isDirectory: () => true,
          mtimeMs: oldTime.getTime(),
          size: 0
        }
      }
      if (p === recentFile) {
        return {
          isSymbolicLink: () => false,
          isFile: () => true,
          isDirectory: () => false,
          mtimeMs: recentTime.getTime(),
          size: 1
        }
      }
      throw new Error('missing')
    })

    const result = await runRuleScan('all')
    const paths = result.items.map((item) => item.path)
    expect(paths).not.toContain(oldDir)
    expect(paths).not.toContain(recentFile)
  })
})

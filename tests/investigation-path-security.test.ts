import { mkdirSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeRelativePath, resolveInvestigationPath } from '../src/main/agent/investigation/path-security'
import { normalizeCandidate } from '../src/shared/candidate-model'

describe('investigation relative path validation', () => {
  it('accepts safe relative paths', () => {
    expect(normalizeRelativePath('cache/tmp')).toBe('cache/tmp')
    expect(normalizeRelativePath('')).toBe('')
  })

  it('rejects absolute paths', () => {
    expect(() => normalizeRelativePath('C:\\Windows')).toThrow(/绝对路径/)
    expect(() => normalizeRelativePath('\\\\server\\share')).toThrow(/绝对路径/)
  })

  it('rejects traversal segments', () => {
    expect(() => normalizeRelativePath('../secret')).toThrow(/路径穿越/)
    expect(() => normalizeRelativePath('cache/../secret')).toThrow(/路径穿越/)
  })
})

describe('investigation protected path blocking', () => {
  let root = ''

  afterEach(() => {
    if (root) {
      require('fs').rmSync(root, { recursive: true, force: true })
      root = ''
    }
  })

  it('rejects protected resolved targets', async () => {
    root = mkdtempSync(join(tmpdir(), 'disk-clean-protected-'))
    mkdirSync(root, { recursive: true })
    const candidate = normalizeCandidate({
      id: 'item-a',
      ruleId: '__analyzer__',
      ruleName: 'Large Dir',
      category: 'dangerous',
      contentType: 'large-dir',
      drive: 'C:',
      path: root,
      size: 1,
      sizeIsEstimate: true,
      snapshotComplete: true,
      entryKind: 'directory',
      deletable: false,
      autoSelect: false,
      source: 'analyzer'
    })

    await expect(
      resolveInvestigationPath({
        candidate,
        relativePath: '',
        protectedPaths: [root]
      })
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' })
  })
})

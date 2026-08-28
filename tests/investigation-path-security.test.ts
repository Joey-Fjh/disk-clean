import { mkdirSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeRelativePath, resolveInvestigationPath } from '../src/main/agent/investigation/path-security'
import { normalizeCandidate } from '../src/shared/candidate-model'
import { DEFAULT_PATH_ACCESS_POLICY } from '../src/shared/path-access-policy'

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

describe('investigation path access tiers', () => {
  let root = ''

  afterEach(() => {
    if (root) {
      require('fs').rmSync(root, { recursive: true, force: true })
      root = ''
    }
  })

  it('rejects denyRead system paths', async () => {
    const candidate = normalizeCandidate({
      id: 'item-sys',
      ruleId: '__analyzer__',
      ruleName: 'System',
      category: 'dangerous',
      contentType: 'system-protected',
      drive: 'C:',
      path: 'C:\\Windows\\System32',
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
        protectedPaths: [],
        accessPolicy: DEFAULT_PATH_ACCESS_POLICY
      })
    ).rejects.toMatchObject({ code: 'PROTECTED_PATH' })
  })

  it('allows read-only investigation for Program Files paths', async () => {
    root = mkdtempSync(join(tmpdir(), 'disk-clean-pf-'))
    const programFiles = join(root, 'Program Files', 'Vendor', 'app')
    mkdirSync(programFiles, { recursive: true })

    const candidate = normalizeCandidate({
      id: 'item-pf',
      ruleId: '__analyzer__',
      ruleName: 'Large Dir',
      category: 'dangerous',
      contentType: 'large-dir',
      drive: 'C:',
      path: programFiles,
      size: 1,
      sizeIsEstimate: true,
      snapshotComplete: true,
      entryKind: 'directory',
      deletable: false,
      autoSelect: false,
      source: 'analyzer'
    })

    const policy = {
      ...DEFAULT_PATH_ACCESS_POLICY,
      readOnlyHighRisk: [root]
    }

    await expect(
      resolveInvestigationPath({
        candidate,
        relativePath: '',
        protectedPaths: [programFiles],
        accessPolicy: policy
      })
    ).resolves.toMatchObject({
      targetPath: expect.stringContaining('Vendor')
    })
  })

  it('does not block generic protected paths that are not denyRead', async () => {
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
    ).resolves.toMatchObject({ candidateRoot: root })
  })
})

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveInvestigationPath } from '../src/main/agent/investigation/path-security'
import { normalizeCandidate } from '../src/shared/candidate-model'

function analyzerItem(path: string, id: string) {
  return normalizeCandidate({
    id,
    ruleId: '__analyzer__',
    ruleName: 'Large Dir',
    category: 'dangerous',
    contentType: 'large-dir',
    drive: 'C:',
    path,
    size: 100,
    sizeIsEstimate: true,
    snapshotComplete: true,
    entryKind: 'directory',
    deletable: false,
    autoSelect: false,
    source: 'analyzer'
  })
}

describe('investigation logical path segment checks', () => {
  let root = ''
  let outside = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    if (outside) rmSync(outside, { recursive: true, force: true })
    root = ''
    outside = ''
  })

  it('allows nested real directories', async () => {
    root = mkdtempSync(join(tmpdir(), 'disk-clean-path-nested-'))
    mkdirSync(join(root, 'nested', 'leaf'), { recursive: true })
    const resolved = await resolveInvestigationPath({
      candidate: analyzerItem(root, 'a'),
      relativePath: 'nested/leaf',
      protectedPaths: []
    })
    expect(resolved.relativePath).toBe('nested/leaf')
  })

  it('blocks junction in the middle of the logical path', async () => {
    root = mkdtempSync(join(tmpdir(), 'disk-clean-path-junction-'))
    outside = mkdtempSync(join(tmpdir(), 'disk-clean-path-outside-'))
    mkdirSync(join(root, 'middle'), { recursive: true })
    const junctionPath = join(root, 'middle', 'escape')
    symlinkSync(outside, junctionPath, 'junction')
    await expect(
      resolveInvestigationPath({
        candidate: analyzerItem(root, 'a'),
        relativePath: 'middle/escape',
        protectedPaths: []
      })
    ).rejects.toMatchObject({ code: 'REPARSE_POINT_BLOCKED' })
  })

  it('blocks junction that points outside candidate root', async () => {
    root = mkdtempSync(join(tmpdir(), 'disk-clean-path-out-escape-'))
    outside = mkdtempSync(join(tmpdir(), 'disk-clean-path-out-target-'))
    const linkPath = join(root, 'escape')
    symlinkSync(outside, linkPath, 'junction')
    await expect(
      resolveInvestigationPath({
        candidate: analyzerItem(root, 'a'),
        relativePath: 'escape',
        protectedPaths: []
      })
    ).rejects.toMatchObject({ code: 'REPARSE_POINT_BLOCKED' })
  })

  it('blocks junction alias that resolves to a protected path', async () => {
    root = mkdtempSync(join(tmpdir(), 'disk-clean-path-protected-alias-'))
    outside = mkdtempSync(join(tmpdir(), 'disk-clean-path-protected-target-'))
    writeFileSync(join(outside, 'secret.txt'), 'x')
    const aliasPath = join(root, 'alias')
    symlinkSync(outside, aliasPath, 'junction')
    await expect(
      resolveInvestigationPath({
        candidate: analyzerItem(root, 'a'),
        relativePath: 'alias',
        protectedPaths: [outside]
      })
    ).rejects.toMatchObject({ code: 'REPARSE_POINT_BLOCKED' })
  })
})

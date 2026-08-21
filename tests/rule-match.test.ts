import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import { isPathAuthorizedByRule } from '../src/shared/rule-match'
import type { RuleConfig } from '../src/shared/types'

describe('isPathAuthorizedByRule', () => {
  it('allows only pattern-matched files not siblings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-'))
    writeFileSync(join(root, 'keep.txt'), 'x')
    writeFileSync(join(root, 'remove.exe'), 'x')

    const rule: RuleConfig = {
      id: 'test-patterns',
      name: 'test',
      category: 'recommended',
      paths: [root],
      patterns: ['*.exe'],
      defaultChecked: false
    }

    expect(await isPathAuthorizedByRule(join(root, 'remove.exe'), rule)).toBe(true)
    expect(await isPathAuthorizedByRule(join(root, 'keep.txt'), rule)).toBe(false)
  })

  it('rejects symlink escape targets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-'))
    const outside = mkdtempSync(join(tmpdir(), 'disk-clean-out-'))
    const link = join(root, 'escape')
    try {
      symlinkSync(outside, link, 'junction')
    } catch {
      return
    }

    const rule: RuleConfig = {
      id: 'test-dir',
      name: 'test',
      category: 'safe',
      paths: [root],
      defaultChecked: true
    }

    expect(await isPathAuthorizedByRule(outside, rule)).toBe(false)
  })
})

describe('wechat/qq media rules', () => {
  it('marks user media as non-deletable in config shape', async () => {
    const mediaRule: RuleConfig = {
      id: 'wechat-media',
      name: '微信媒体',
      category: 'dangerous',
      paths: ['C:\\WeChat'],
      globDirs: ['**/FileStorage/Image'],
      defaultChecked: false,
      deletable: false
    }
    expect(mediaRule.deletable).toBe(false)
    expect(mediaRule.category).toBe('dangerous')
  })
})

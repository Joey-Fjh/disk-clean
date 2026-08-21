import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import { collectRuleTargets, resolveContainedUnderBase } from '../src/shared/rule-match'
import { validateRuleInput } from '../src/main/rules/rule-validator'
import type { RuleConfig } from '../src/shared/types'

describe('rule path escape containment', () => {
  const safeBase = mkdtempSync(join(tmpdir(), 'disk-clean-safe-'))
  const outside = mkdtempSync(join(tmpdir(), 'disk-clean-out-'))

  it('rejects absolute subdir escape at import', () => {
    const rule = validateRuleInput({
      id: 'escape-abs',
      name: 'escape',
      category: 'recommended',
      paths: [safeBase],
      subdirs: [`${outside}\\data`],
      defaultChecked: false
    })
    expect(rule).toBeNull()
  })

  it('rejects UNC and root-relative segments', () => {
    expect(
      validateRuleInput({
        id: 'escape-unc',
        name: 'escape',
        category: 'recommended',
        paths: [safeBase],
        subdirs: ['\\\\server\\share\\data'],
        defaultChecked: false
      })
    ).toBeNull()

    expect(
      validateRuleInput({
        id: 'escape-root',
        name: 'escape',
        category: 'recommended',
        paths: [safeBase],
        globDirs: ['\\Windows'],
        defaultChecked: false
      })
    ).toBeNull()
  })

  it('rejects .. escape in patterns', () => {
    const rule = validateRuleInput({
      id: 'escape-dot',
      name: 'escape',
      category: 'recommended',
      paths: [safeBase],
      patterns: ['..\\secret\\*.tmp'],
      defaultChecked: false
    })
    expect(rule).toBeNull()
  })

  it('allows normal relative subdir', () => {
    const cache = join(safeBase, 'cache')
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, 'a.tmp'), 'x')

    const resolved = resolveContainedUnderBase(safeBase, 'cache')
    expect(resolved?.toLowerCase()).toBe(cache.toLowerCase())

    const rule: RuleConfig = {
      id: 'ok-sub',
      name: 'ok',
      category: 'safe',
      paths: [safeBase],
      subdirs: ['cache'],
      defaultChecked: true
    }
    return collectRuleTargets(rule).then((targets) => {
      expect(targets.some((t) => t.toLowerCase() === cache.toLowerCase())).toBe(true)
      expect(targets.every((t) => t.toLowerCase().startsWith(safeBase.toLowerCase()))).toBe(true)
    })
  })

  it('collectRuleTargets does not return paths outside base', async () => {
    const rule: RuleConfig = {
      id: 'manual-escape',
      name: 'manual',
      category: 'safe',
      paths: [safeBase],
      subdirs: ['cache'],
      defaultChecked: true
    }
    const targets = await collectRuleTargets(rule)
    for (const target of targets) {
      expect(target.toLowerCase().startsWith(safeBase.toLowerCase())).toBe(true)
    }
  })
})

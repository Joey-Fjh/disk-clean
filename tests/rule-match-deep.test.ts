import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import { isPathAuthorizedByRule } from '../src/shared/rule-match'
import type { RuleConfig } from '../src/shared/types'

describe('isPathAuthorizedByRule deep descendants', () => {
  it('authorizes nested files under recorded rule root anchor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-anchor-'))
    const nested = join(root, 'old-folder', 'nested')
    mkdirSync(nested, { recursive: true })
    const file = join(nested, 'old.log')
    writeFileSync(file, 'data')

    const rule: RuleConfig = {
      id: 'user-temp',
      name: 'Temp',
      category: 'safe',
      paths: [root],
      maxAgeDays: 7,
      defaultChecked: false
    }

    expect(await isPathAuthorizedByRule(file, rule, { parentTarget: root })).toBe(true)
    expect(await isPathAuthorizedByRule(join(root, 'outside-root.log'), rule, { parentTarget: root })).toBe(
      true
    )
  })

  it('rejects files outside the rule root anchor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-clean-out-'))
    const other = mkdtempSync(join(tmpdir(), 'disk-clean-other-'))
    const file = join(other, 'secret.log')
    writeFileSync(file, 'x')

    const rule: RuleConfig = {
      id: 'user-temp',
      name: 'Temp',
      category: 'safe',
      paths: [root],
      defaultChecked: false
    }

    expect(await isPathAuthorizedByRule(file, rule, { parentTarget: root })).toBe(false)
  })
})

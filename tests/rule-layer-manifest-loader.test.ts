import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { RULE_PACK_SCHEMA_VERSION } from '../src/shared/rule-layer-types'
import { loadOfficialPacksFromDir } from '../src/main/rules/rule-layer-loader'
import { isRuleActiveForScan } from '../src/shared/rule-enforcement'
import type { RuleConfig } from '../src/shared/types'

describe('official manifest loader', () => {
  let dir = ''

  afterEach(() => {
    if (dir) {
      require('fs').rmSync(dir, { recursive: true, force: true })
      dir = ''
    }
  })

  it('sanitizes rules inside formal schemaVersion manifests', () => {
    dir = mkdtempSync(join(tmpdir(), 'disk-clean-manifest-'))
    const manifest = {
      schemaVersion: RULE_PACK_SCHEMA_VERSION,
      id: 'official-test-pack',
      name: 'Test Pack',
      version: '1.0.0',
      origin: 'official',
      platform: 'windows',
      rules: [
        {
          id: 'bad-managed',
          name: 'Bad Managed',
          category: 'safe',
          paths: ['%TEMP%'],
          defaultChecked: false,
          cleanupMethod: 'system_managed',
          deletable: true
        } satisfies RuleConfig
      ]
    }
    writeFileSync(join(dir, 'test-pack.json'), JSON.stringify(manifest), 'utf-8')

    const [pack] = loadOfficialPacksFromDir(dir)
    expect(pack.id).toBe('official-test-pack')
    expect(pack.rules).toHaveLength(1)
    expect(pack.rules[0].reviewStatus).toBe('disabled')
    expect(pack.rules[0].deletable).toBe(false)
    expect(isRuleActiveForScan(pack.rules[0])).toBe(false)
    expect(pack.rules[0].notes).toContain('cleanupMethod')
  })
})

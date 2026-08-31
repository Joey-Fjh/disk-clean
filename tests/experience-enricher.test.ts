import { describe, expect, it } from 'vitest'
import { enrichItemsWithUserExperiences, matchesUserExperience } from '../src/main/experience/experience-enricher'
import type { ScanItem } from '../src/shared/types'
import type { UserExperienceEntry } from '../src/shared/user-experience-types'

function item(partial: Partial<ScanItem> & Pick<ScanItem, 'id' | 'path'>): ScanItem {
  return {
    id: partial.id,
    path: partial.path,
    drive: partial.drive ?? 'C:',
    size: partial.size ?? 100,
    category: partial.category ?? 'safe',
    ruleId: partial.ruleId ?? 'rule-a',
    ruleName: partial.ruleName ?? 'Temp Cache',
    contentType: partial.contentType ?? 'app-cache',
    reason: partial.reason ?? 'cache',
    impact: partial.impact ?? 'low',
    source: partial.rule,
    discoverySources: partial.discoverySources ?? ['rule'],
    deletable: partial.deletable ?? true,
    defaultChecked: partial.defaultChecked ?? true,
    judgment: partial.judgment ?? {
      status: 'suggested',
      source: 'rule',
      confidence: 'high',
      basis: []
    },
    selection: partial.selection ?? { selectable: true, autoSelect: true },
    requiresAppClosed: partial.requiresAppClosed ?? false,
    snapshotComplete: partial.snapshotComplete ?? true,
    entryKind: partial.entryKind ?? 'directory',
    sizePartial: partial.sizePartial ?? false
  } as ScanItem
}

const keepEntry: UserExperienceEntry = {
  id: 'exp-1',
  kind: 'keep-exclusion',
  name: '保留 Chrome 缓存',
  enabled: true,
  matcher: {
    ruleId: 'rule-a',
    contentType: 'app-cache',
    relativePathSuffix: 'Google\\Chrome\\User Data\\Cache'
  },
  reason: '用户确认保留',
  source: 'user-confirmed',
  createdAt: 1,
  updatedAt: 1
}

describe('experience enricher', () => {
  it('matches by relative path suffix and rule metadata', () => {
    const scanItem = item({
      id: '1',
      path: 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Cache\\abc'
    })
    expect(matchesUserExperience(scanItem, keepEntry)).toBe(true)
  })

  it('downgrades keep experience to non-selectable keep judgment', () => {
    const [result] = enrichItemsWithUserExperiences(
      [
        item({
          id: '1',
          path: 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Cache\\abc'
        })
      ],
      [keepEntry]
    )
    expect(result.judgment?.status).toBe('keep')
    expect(result.selection.selectable).toBe(false)
    expect(result.deletable).toBe(false)
  })

  it('adds recognition hints without granting deletable', () => {
    const hint: UserExperienceEntry = {
      ...keepEntry,
      id: 'exp-2',
      kind: 'recognition-hint',
      matcher: { softwareName: 'Temp Cache' }
    }
    const [result] = enrichItemsWithUserExperiences([item({ id: '1', path: 'C:\\x' })], [hint])
    expect(result.deletable).toBe(true)
    expect(result.evidence.some((entry) => entry.summary.includes('用户确认保留'))).toBe(true)
  })

  it('ignores disabled experiences', () => {
    const [result] = enrichItemsWithUserExperiences(
      [item({ id: '1', path: 'C:\\x\\Cache\\a' })],
      [{ ...keepEntry, enabled: false }]
    )
    expect(result.judgment?.status).toBe('suggested')
    expect(result.selection.selectable).toBe(true)
  })
})

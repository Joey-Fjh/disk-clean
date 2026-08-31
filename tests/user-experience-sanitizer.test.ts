import { describe, expect, it } from 'vitest'
import {
  assertUserExperienceJsonSize,
  sanitizeUserExperienceStore
} from '../src/main/experience/user-experience-sanitizer'
import { USER_EXPERIENCE_LIMITS } from '../src/shared/user-experience-limits'

describe('user experience sanitizer', () => {
  it('isolates invalid entries and keeps valid ones', () => {
    const { state, isolated } = sanitizeUserExperienceStore({
      schemaVersion: 1,
      entries: [
        {
          id: 'ok',
          kind: 'keep-exclusion',
          name: '保留项',
          enabled: true,
          matcher: { ruleId: 'rule-a', relativePathSuffix: 'Cache' },
          reason: '用户确认',
          source: 'user-confirmed',
          createdAt: 1,
          updatedAt: 1
        },
        { id: 'bad', kind: 'evil', matcher: {} }
      ]
    })
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]?.id).toBe('ok')
    expect(isolated).toHaveLength(1)
  })

  it('enforces max entry count', () => {
    const entries = Array.from({ length: USER_EXPERIENCE_LIMITS.MAX_ENTRIES + 5 }, (_, index) => ({
      id: `id-${index}`,
      kind: 'recognition-hint',
      name: `hint-${index}`,
      enabled: true,
      matcher: { softwareName: 'x' },
      reason: 'hint',
      source: 'user-confirmed',
      createdAt: 1,
      updatedAt: 1
    }))
    const { state } = sanitizeUserExperienceStore({ schemaVersion: 1, entries })
    expect(state.entries).toHaveLength(USER_EXPERIENCE_LIMITS.MAX_ENTRIES)
  })

  it('rejects duplicate ids and marks store changed', () => {
    const entry = {
      id: 'dup',
      kind: 'keep-exclusion',
      name: 'a',
      enabled: true,
      matcher: { ruleId: 'r1' },
      reason: 'r',
      source: 'user-confirmed',
      createdAt: 1,
      updatedAt: 1
    }
    const { state, isolated, changed } = sanitizeUserExperienceStore({
      schemaVersion: 1,
      entries: [entry, entry]
    })
    expect(state.entries).toHaveLength(1)
    expect(isolated).toHaveLength(1)
    expect(changed).toBe(true)
  })

  it('rejects invalid timestamps', () => {
    const { state } = sanitizeUserExperienceStore({
      schemaVersion: 1,
      entries: [
        {
          id: 'bad-time',
          kind: 'keep-exclusion',
          name: 'a',
          enabled: true,
          matcher: { ruleId: 'r1' },
          reason: 'r',
          source: 'user-confirmed',
          createdAt: -1,
          updatedAt: Number.NaN
        }
      ]
    })
    expect(state.entries).toHaveLength(0)
  })

  it('asserts json byte size before parse', () => {
    const oversized = 'x'.repeat(USER_EXPERIENCE_LIMITS.MAX_JSON_BYTES + 1)
    expect(() => assertUserExperienceJsonSize(oversized)).toThrow('经验数据过大')
  })
})

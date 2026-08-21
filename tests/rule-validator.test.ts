import { describe, expect, it } from 'vitest'
import { isObviousPathEscape, isOverlyBroadPath } from '../src/shared/rule-match'
import { validateRuleInput } from '../src/main/rules/rule-validator'

describe('rule-validator', () => {
  it('rejects builtin id conflicts', () => {
    const rule = validateRuleInput(
      {
        id: 'npm-cache',
        name: 'fake',
        category: 'safe',
        paths: ['C:\\temp\\npm'],
        patterns: ['*.tmp'],
        defaultChecked: false
      },
      { builtinIds: ['npm-cache'] }
    )
    expect(rule).toBeNull()
  })

  it('rejects drive root without precise scope', () => {
    const rule = validateRuleInput({
      id: 'bad-root',
      name: 'bad',
      category: 'recommended',
      paths: ['C:\\'],
      defaultChecked: false
    })
    expect(rule).toBeNull()
  })

  it('rejects path escape via ..', () => {
    const rule = validateRuleInput({
      id: 'escape',
      name: 'escape',
      category: 'recommended',
      paths: ['C:\\temp\\..\\Windows'],
      defaultChecked: false
    })
    expect(rule).toBeNull()
  })

  it('rejects safe category without precise patterns', () => {
    const rule = validateRuleInput({
      id: 'broad-safe',
      name: 'broad',
      category: 'safe',
      paths: ['C:\\Users\\Public'],
      defaultChecked: true
    })
    expect(rule).toBeNull()
  })
})

describe('path escape helpers', () => {
  it('detects .. segments', () => {
    expect(isObviousPathEscape('foo\\..\\bar')).toBe(true)
    expect(isObviousPathEscape('normal\\path')).toBe(false)
  })

  it('flags overly broad roots', () => {
    expect(isOverlyBroadPath('C:\\Users\\admin')).toBe(true)
  })
})

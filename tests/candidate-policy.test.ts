import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { shouldAutoSelect } from '../src/shared/candidate-policy'

describe('shouldAutoSelect', () => {
  it('auto-selects builtin safe with defaultChecked', () => {
    expect(shouldAutoSelect({ defaultChecked: true, category: 'safe', source: 'builtin' })).toBe(true)
  })

  it('does not auto-select custom safe rules', () => {
    expect(shouldAutoSelect({ defaultChecked: true, category: 'safe', source: 'custom' })).toBe(false)
  })

  it('does not auto-select when snapshot is incomplete', () => {
    expect(shouldAutoSelect({ defaultChecked: true, category: 'safe', source: 'builtin' }, false)).toBe(
      false
    )
  })

  it('does not auto-select when defaultChecked is false', () => {
    expect(shouldAutoSelect({ defaultChecked: false, category: 'safe', source: 'builtin' })).toBe(false)
  })
})

describe('apps.json user media rules', () => {
  const apps = JSON.parse(readFileSync(join(process.cwd(), 'config/rules/apps.json'), 'utf-8')) as {
    rules: Array<{ id: string; category: string; deletable?: boolean; globDirs?: string[] }>
  }

  it('wechat media is view-only', () => {
    const media = apps.rules.find((r) => r.id === 'wechat-media')
    expect(media?.category).toBe('dangerous')
    expect(media?.deletable).toBe(false)
    expect(media?.globDirs).toContain('**/FileStorage/Image')
  })

  it('qq user files are view-only', () => {
    const qq = apps.rules.find((r) => r.id === 'qq-preview-cache')
    expect(qq?.category).toBe('dangerous')
    expect(qq?.deletable).toBe(false)
    expect(qq?.globDirs).toContain('**/FileRecv')
  })

  it('wechat cache remains deletable recommended', () => {
    const cache = apps.rules.find((r) => r.id === 'wechat-cache')
    expect(cache?.category).toBe('recommended')
    expect(cache?.globDirs).toEqual(['**/FileStorage/Cache'])
  })
})

import { describe, expect, it } from 'vitest'
import { ProviderTestState } from '../src/renderer/provider-test-state'

describe('ProviderTestState', () => {
  it('tracks concurrent tests independently without clearing each other', async () => {
    const state = new ProviderTestState()

    let resolveA!: () => void
    let resolveB!: () => void
    const gateA = new Promise<void>((resolve) => {
      resolveA = resolve
    })
    const gateB = new Promise<void>((resolve) => {
      resolveB = resolve
    })

    const genA = state.beginTest('profile-a', '正在测试连接…')
    const genB = state.beginTest('profile-b', '正在测试连接…')

    expect(state.isTesting('profile-a')).toBe(true)
    expect(state.isTesting('profile-b')).toBe(true)

    const doneB = gateB.then(() => {
      state.completeTest('profile-b', genB, { message: 'B 成功', tone: 'success' })
    })
    resolveB()
    await doneB

    expect(state.isTesting('profile-a')).toBe(true)
    expect(state.isTesting('profile-b')).toBe(false)
    expect(state.getLastTestStatus('profile-b')?.message).toBe('B 成功')

    const doneA = gateA.then(() => {
      state.completeTest('profile-a', genA, { message: 'A 成功', tone: 'success' })
    })
    resolveA()
    await doneA

    expect(state.isTesting('profile-a')).toBe(false)
    expect(state.getLastTestStatus('profile-a')?.message).toBe('A 成功')
  })

  it('invalidates stale results after profile update or delete', () => {
    const state = new ProviderTestState()
    const generation = state.beginTest('profile-a', '正在测试连接…')

    state.invalidateProfile('profile-a')

    const applied = state.completeTest('profile-a', generation, {
      message: '不应显示',
      tone: 'success'
    })

    expect(applied).toBe(false)
    expect(state.isTesting('profile-a')).toBe(false)
    expect(state.getLastTestStatus('profile-a')).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { shouldAutoSelect } from '../src/shared/candidate-policy'

describe('requiresAppClosed selection policy', () => {
  it('never auto-selects rules that require closing apps', () => {
    expect(
      shouldAutoSelect(
        {
          defaultChecked: true,
          category: 'safe',
          source: 'builtin',
          requiresAppClosed: true
        },
        true
      )
    ).toBe(false)
  })
})

import type { Category } from './types'

export function shouldAutoSelect(
  rule: {
    defaultChecked: boolean
    category: Category
    source?: 'builtin' | 'custom'
    requiresAppClosed?: boolean
  },
  snapshotComplete = true
): boolean {
  return (
    rule.defaultChecked === true &&
    rule.category === 'safe' &&
    rule.source !== 'custom' &&
    rule.requiresAppClosed !== true &&
    snapshotComplete
  )
}
